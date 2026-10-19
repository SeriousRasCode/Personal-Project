import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto.js';
import type { LeakReportCreatedResponseDto } from '../src/modules/leaks/dto/leak-response.dto.js';
import type {
  MultipartUpload,
  ObjectStorage,
  PresignedDownload,
  PresignedRequest,
  StoredObject,
} from '../src/modules/storage/object-storage.js';
import { OBJECT_STORAGE } from '../src/modules/storage/object-storage.js';
import type { PresignUploadResponseDto } from '../src/modules/storage/dto/storage-response.dto.js';

type InjectResponse = Awaited<ReturnType<NestFastifyApplication['inject']>>;

function jsonBody<T>(response: InjectResponse): T {
  return response.json<T>();
}

class InMemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, StoredObject>();
  readonly uploads: string[] = [];
  readonly completed: { objectKey: string; parts: { partNumber: number }[] }[] =
    [];
  readonly aborted: string[] = [];
  readonly deleted: string[] = [];
  nextUploadId = 1;

  presignUpload(input: {
    objectKey: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<PresignedRequest> {
    this.uploads.push(input.objectKey);
    return Promise.resolve({
      url: `https://storage.test/${input.objectKey}`,
      method: 'PUT',
      expiresInSeconds: input.expiresInSeconds,
      headers: { 'Content-Type': input.contentType },
    });
  }

  createMultipartUpload(): Promise<{ uploadId: string }> {
    return Promise.resolve({ uploadId: `upload-${this.nextUploadId++}` });
  }

  presignUploadPart(input: {
    objectKey: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds: number;
  }): Promise<PresignedRequest> {
    return Promise.resolve({
      url: `https://storage.test/${input.objectKey}?part=${input.partNumber}`,
      method: 'PUT',
      expiresInSeconds: input.expiresInSeconds,
      headers: {},
    });
  }

  async completeMultipartUpload(input: {
    objectKey: string;
    parts: { partNumber: number }[];
  }): Promise<void> {
    this.completed.push({ objectKey: input.objectKey, parts: input.parts });
    return Promise.resolve();
  }

  abortMultipartUpload(input: { objectKey: string }): Promise<void> {
    this.aborted.push(input.objectKey);
    return Promise.resolve();
  }

  presignDownload(input: {
    objectKey: string;
    expiresInSeconds: number;
  }): Promise<PresignedDownload> {
    return Promise.resolve({
      url: `https://storage.test/download/${input.objectKey}`,
      expiresInSeconds: input.expiresInSeconds,
    });
  }

  headObject(objectKey: string): Promise<StoredObject | null> {
    return Promise.resolve(this.objects.get(objectKey) ?? null);
  }

  putObject(input: {
    objectKey: string;
    body: string | Buffer;
    contentType: string;
  }): Promise<StoredObject> {
    const stored: StoredObject = {
      contentType: input.contentType,
      contentLength: typeof input.body === 'string' ? input.body.length : 2_048,
      etag: '"stub-etag"',
    };
    this.objects.set(input.objectKey, stored);
    return Promise.resolve(stored);
  }

  deleteObject(objectKey: string): Promise<void> {
    this.deleted.push(objectKey);
    this.objects.delete(objectKey);
    return Promise.resolve();
  }
}

const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE ?? '+251900000000';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'HydroJimma!2026';
const CITIZEN_PHONE = '+251922200007';
const CITIZEN_PASSWORD = 'Citizen!2026';
const OTHER_PHONE = '+251922200008';
const OTHER_PASSWORD = 'Citizen!2026';
const TECHNICIAN_PHONE = '+251911100007';
const TECHNICIAN_PASSWORD = 'FieldTech!2026';

const LARGE_PHOTO_BYTES = 8 * 1024 * 1024;
const DESCRIPTION =
  'Water is spraying continuously from the pipe beside the road.';

describe('Object storage (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let storage: InMemoryObjectStorage;
  let adminToken: string;
  let citizenToken: string;
  let otherToken: string;
  let technicianToken: string;
  let citizenId: string;
  let otherId: string;
  const createdReportIds: string[] = [];

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const login = async (phone: string, password: string): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { phone, password },
    });
    expect(response.statusCode).toBe(200);
    return jsonBody<AuthResponseDto>(response).accessToken;
  };

  const registerAndActivate = async (
    phone: string,
    password: string,
    displayName: string,
  ): Promise<string> => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { phone, displayName, password },
    });
    expect(registered.statusCode).toBe(201);

    const pending = await prisma.user.findUnique({
      where: { phone },
      select: { id: true },
    });
    if (!pending) {
      throw new Error(`User ${phone} is missing`);
    }

    const activated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${pending.id}/status`,
      headers: auth(adminToken),
      payload: { status: 'ACTIVE' },
    });
    expect(activated.statusCode).toBe(200);

    return pending.id;
  };

  const presign = (
    token: string | null,
    payload: Record<string, unknown>,
  ): Promise<InjectResponse> =>
    app.inject({
      method: 'POST',
      url: '/api/v1/storage/uploads',
      ...(token ? { headers: auth(token) } : {}),
      payload,
    });

  beforeAll(async () => {
    storage = new InMemoryObjectStorage();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storage)
      .compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(PrismaService);
    adminToken = await login(ADMIN_PHONE, ADMIN_PASSWORD);

    await prisma.user.deleteMany({
      where: {
        phone: { in: [CITIZEN_PHONE, OTHER_PHONE, TECHNICIAN_PHONE] },
      },
    });

    citizenId = await registerAndActivate(
      CITIZEN_PHONE,
      CITIZEN_PASSWORD,
      'Storage Citizen',
    );
    citizenToken = await login(CITIZEN_PHONE, CITIZEN_PASSWORD);

    otherId = await registerAndActivate(
      OTHER_PHONE,
      OTHER_PASSWORD,
      'Other Citizen',
    );
    otherToken = await login(OTHER_PHONE, OTHER_PASSWORD);

    const technician = await app.inject({
      method: 'POST',
      url: '/api/v1/users/staff',
      headers: auth(adminToken),
      payload: {
        phone: TECHNICIAN_PHONE,
        displayName: 'Storage Technician',
        password: TECHNICIAN_PASSWORD,
        role: 'FIELD_TECHNICIAN',
      },
    });
    expect(technician.statusCode).toBe(201);
    technicianToken = await login(TECHNICIAN_PHONE, TECHNICIAN_PASSWORD);
  }, 120_000);

  afterAll(async () => {
    if (createdReportIds.length > 0) {
      await prisma.leakReport.deleteMany({
        where: { id: { in: createdReportIds } },
      });
      await prisma.outboxEvent.deleteMany({
        where: { aggregateId: { in: createdReportIds } },
      });
    }
    await prisma.leakCluster.deleteMany({
      where: { code: { startsWith: 'STG' } },
    });
    await prisma.outboxEvent.deleteMany({
      where: { aggregateId: { startsWith: 'STG' } },
    });
    await prisma.user.deleteMany({
      where: {
        phone: { in: [CITIZEN_PHONE, OTHER_PHONE, TECHNICIAN_PHONE] },
      },
    });
    await app.close();
  });

  describe('presigning', () => {
    it('rejects an anonymous upload request', async () => {
      const response = await presign(null, {
        contentType: 'image/jpeg',
        contentLength: 2_048,
      });

      expect(response.statusCode).toBe(401);
    });

    it('rejects an unsupported content type', async () => {
      const response = await presign(citizenToken, {
        contentType: 'application/pdf',
        contentLength: 2_048,
      });

      expect(response.statusCode).toBe(400);
      expect(storage.uploads).toHaveLength(0);
    });

    it('rejects an out of range content length', async () => {
      const tooSmall = await presign(citizenToken, {
        contentType: 'image/jpeg',
        contentLength: 0,
      });
      expect(tooSmall.statusCode).toBe(400);

      const tooLarge = await presign(citizenToken, {
        contentType: 'image/jpeg',
        contentLength: 50 * 1024 * 1024,
      });
      expect(tooLarge.statusCode).toBe(400);
    });

    it('rejects unknown fields', async () => {
      const response = await presign(citizenToken, {
        contentType: 'image/jpeg',
        contentLength: 2_048,
        objectKey: 'leaks/other-user/2026/01/stolen.jpg',
      });

      expect(response.statusCode).toBe(400);
    });

    it('reserves an owner scoped key for a single upload', async () => {
      const response = await presign(citizenToken, {
        contentType: 'image/jpeg',
        contentLength: 2_048,
        fileName: '../../etc/passwd.jpg',
      });

      expect(response.statusCode).toBe(200);
      const upload = jsonBody<PresignUploadResponseDto>(response);
      expect(upload.objectKey).toMatch(
        new RegExp(`^leaks/${citizenId}/\\d{4}/\\d{2}/[\\w-]+\\.jpg$`),
      );
      expect(upload.objectKey).not.toContain('..');
      expect(upload.uploadUrl).toContain(upload.objectKey);
      expect(upload.headers['Content-Type']).toBe('image/jpeg');
      expect(upload.multipart).toBeNull();
      expect(storage.uploads).toEqual([upload.objectKey]);
    });

    it('hands out one signed part per chunk of a large photo', async () => {
      const response = await presign(citizenToken, {
        contentType: 'image/png',
        contentLength: LARGE_PHOTO_BYTES,
      });

      expect(response.statusCode).toBe(200);
      const upload = jsonBody<PresignUploadResponseDto>(response);
      expect(upload.objectKey).toContain('leaks/');
      expect(upload.objectKey.endsWith('.png')).toBe(true);

      const multipart = upload.multipart as MultipartUpload;
      expect(multipart.uploadId).toMatch(/^upload-\d+$/);
      expect(multipart.parts).toHaveLength(2);
      expect(multipart.parts.map((part) => part.partNumber)).toEqual([1, 2]);
      expect(multipart.parts[0]?.url).toContain('part=1');

      const completed = await app.inject({
        method: 'POST',
        url: '/api/v1/storage/uploads/complete',
        headers: auth(citizenToken),
        payload: {
          objectKey: upload.objectKey,
          uploadId: multipart.uploadId,
          parts: [
            { partNumber: 2, etag: '"b"' },
            { partNumber: 1, etag: '"a"' },
          ],
        },
      });
      expect(completed.statusCode).toBe(200);
      expect(storage.completed).toEqual([
        {
          objectKey: upload.objectKey,
          parts: [
            { partNumber: 2, etag: '"b"' },
            { partNumber: 1, etag: '"a"' },
          ],
        },
      ]);
    });

    it('releases an abandoned multipart upload', async () => {
      const response = await presign(citizenToken, {
        contentType: 'image/png',
        contentLength: LARGE_PHOTO_BYTES,
      });
      const upload = jsonBody<PresignUploadResponseDto>(response);
      const multipart = upload.multipart as MultipartUpload;

      const aborted = await app.inject({
        method: 'POST',
        url: '/api/v1/storage/uploads/abort',
        headers: auth(citizenToken),
        payload: {
          objectKey: upload.objectKey,
          uploadId: multipart.uploadId,
        },
      });
      expect(aborted.statusCode).toBe(200);
      expect(storage.aborted).toContain(upload.objectKey);
    });
  });

  describe('ownership', () => {
    let citizenKey: string;
    let otherKey: string;

    beforeAll(async () => {
      citizenKey = jsonBody<PresignUploadResponseDto>(
        await presign(citizenToken, {
          contentType: 'image/jpeg',
          contentLength: 2_048,
        }),
      ).objectKey;
      otherKey = jsonBody<PresignUploadResponseDto>(
        await presign(otherToken, {
          contentType: 'image/jpeg',
          contentLength: 2_048,
        }),
      ).objectKey;

      await storage.putObject({
        objectKey: citizenKey,
        body: 'photo',
        contentType: 'image/jpeg',
      });
      await storage.putObject({
        objectKey: otherKey,
        body: 'photo',
        contentType: 'image/jpeg',
      });
    });

    it('signs a download for the owner and for reviewers only', async () => {
      const owner = await app.inject({
        method: 'GET',
        url: `/api/v1/storage/download/${encodeURIComponent(citizenKey)}`,
        headers: auth(citizenToken),
      });
      expect(owner.statusCode).toBe(200);
      expect(jsonBody<{ url: string }>(owner).url).toContain(citizenKey);

      for (const reviewer of [adminToken, technicianToken]) {
        const response = await app.inject({
          method: 'GET',
          url: `/api/v1/storage/download/${encodeURIComponent(citizenKey)}`,
          headers: auth(reviewer),
        });
        expect(response.statusCode).toBe(200);
      }

      const stranger = await app.inject({
        method: 'GET',
        url: `/api/v1/storage/download/${encodeURIComponent(citizenKey)}`,
        headers: auth(otherToken),
      });
      expect(stranger.statusCode).toBe(403);
    });

    it('rejects an anonymous download', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/storage/download/${encodeURIComponent(citizenKey)}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('blocks a delete from another account', async () => {
      const stranger = await app.inject({
        method: 'DELETE',
        url: `/api/v1/storage/objects/${encodeURIComponent(citizenKey)}`,
        headers: auth(otherToken),
      });
      expect(stranger.statusCode).toBe(403);
      expect(storage.deleted).not.toContain(citizenKey);

      const owner = await app.inject({
        method: 'DELETE',
        url: `/api/v1/storage/objects/${encodeURIComponent(citizenKey)}`,
        headers: auth(citizenToken),
      });
      expect(owner.statusCode).toBe(200);
      expect(storage.deleted).toContain(citizenKey);
      expect(storage.objects.has(citizenKey)).toBe(false);
    });

    it('stops another account from completing or aborting an upload', async () => {
      const complete = await app.inject({
        method: 'POST',
        url: '/api/v1/storage/uploads/complete',
        headers: auth(otherToken),
        payload: { objectKey: citizenKey },
      });
      expect(complete.statusCode).toBe(403);

      const abort = await app.inject({
        method: 'POST',
        url: '/api/v1/storage/uploads/abort',
        headers: auth(otherToken),
        payload: { objectKey: citizenKey, uploadId: 'upload-9' },
      });
      expect(abort.statusCode).toBe(403);
      expect(storage.aborted).not.toContain(citizenKey);
    });

    it('lets reviewers download but not mutate another account photo', async () => {
      const complete = await app.inject({
        method: 'POST',
        url: '/api/v1/storage/uploads/complete',
        headers: auth(technicianToken),
        payload: { objectKey: otherKey },
      });
      expect(complete.statusCode).toBe(403);

      const abort = await app.inject({
        method: 'POST',
        url: '/api/v1/storage/uploads/abort',
        headers: auth(technicianToken),
        payload: { objectKey: otherKey, uploadId: 'upload-9' },
      });
      expect(abort.statusCode).toBe(403);

      const deletion = await app.inject({
        method: 'DELETE',
        url: `/api/v1/storage/objects/${encodeURIComponent(otherKey)}`,
        headers: auth(technicianToken),
      });
      expect(deletion.statusCode).toBe(403);
      expect(storage.objects.has(otherKey)).toBe(true);
    });
  });

  describe('leak report photos', () => {
    const reportWithPhoto = async (
      token: string,
      photoObjectKey?: string,
    ): Promise<InjectResponse> => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/leaks/reports',
        headers: auth(token),
        payload: {
          location: { longitude: 36.8319, latitude: 7.6667 },
          description: DESCRIPTION,
          ...(photoObjectKey ? { photoObjectKey } : {}),
        },
      });

      if (response.statusCode === 201) {
        createdReportIds.push(
          jsonBody<LeakReportCreatedResponseDto>(response).report.id,
        );
      }

      return response;
    };

    it('attaches a photo the caller uploaded', async () => {
      const upload = jsonBody<PresignUploadResponseDto>(
        await presign(citizenToken, {
          contentType: 'image/jpeg',
          contentLength: 2_048,
        }),
      );

      await storage.putObject({
        objectKey: upload.objectKey,
        body: 'photo',
        contentType: 'image/jpeg',
      });

      const response = await reportWithPhoto(citizenToken, upload.objectKey);
      expect(response.statusCode).toBe(201);
      expect(
        jsonBody<LeakReportCreatedResponseDto>(response).report.photoObjectKey,
      ).toBe(upload.objectKey);
    });

    it('refuses an upload key before the photo is uploaded', async () => {
      const upload = jsonBody<PresignUploadResponseDto>(
        await presign(citizenToken, {
          contentType: 'image/jpeg',
          contentLength: 2_048,
        }),
      );

      const response = await reportWithPhoto(citizenToken, upload.objectKey);
      expect(response.statusCode).toBe(404);
    });

    it('refuses a photo uploaded by another account', async () => {
      const upload = jsonBody<PresignUploadResponseDto>(
        await presign(otherToken, {
          contentType: 'image/jpeg',
          contentLength: 2_048,
        }),
      );

      const response = await reportWithPhoto(citizenToken, upload.objectKey);
      expect(response.statusCode).toBe(403);
      expect(storage.objects.has(upload.objectKey)).toBe(false);

      const rejected = await prisma.leakReport.findFirst({
        where: { photoObjectKey: upload.objectKey },
        select: { id: true },
      });
      expect(rejected).toBeNull();
    });

    it('refuses a hand written key that is not owner scoped', async () => {
      for (const photoObjectKey of [
        'not-a-key',
        'leaks/other-user/2026/01/photo.jpg',
        `leaks/${otherId}/2026/01/photo.jpg`,
        '../../etc/passwd',
      ]) {
        const response = await reportWithPhoto(citizenToken, photoObjectKey);
        expect(response.statusCode).toBe(403);
      }
    });

    it('still accepts a report without a photo', async () => {
      const response = await reportWithPhoto(citizenToken);

      expect(response.statusCode).toBe(201);
      expect(
        jsonBody<LeakReportCreatedResponseDto>(response).report.photoObjectKey,
      ).toBeNull();
    });

    it('requires a signed in reporter', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/leaks/reports',
        payload: {
          location: { longitude: 36.8319, latitude: 7.6667 },
          description: DESCRIPTION,
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
