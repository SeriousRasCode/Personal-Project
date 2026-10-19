import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '../../generated/prisma/enums.js';
import type {
  ObjectStorage,
  PresignedDownload,
  PresignedRequest,
  StoredObject,
} from './object-storage.js';
import { StorageService, type StorageActor } from './storage.service.js';
import { MAX_IMAGE_BYTES, MIN_MULTIPART_BYTES } from './storage-policy.js';

class FakeObjectStorage implements ObjectStorage {
  readonly uploads: { objectKey: string; contentType: string }[] = [];
  readonly parts: { objectKey: string; partNumber: number }[] = [];
  readonly completed: { objectKey: string; parts: { partNumber: number }[] }[] =
    [];
  readonly aborted: string[] = [];
  readonly deleted: string[] = [];
  readonly stored = new Map<string, StoredObject>();

  presignUpload(input: {
    objectKey: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<PresignedRequest> {
    this.uploads.push({
      objectKey: input.objectKey,
      contentType: input.contentType,
    });

    return Promise.resolve({
      url: `https://storage.test/${input.objectKey}`,
      method: 'PUT' as const,
      expiresInSeconds: input.expiresInSeconds,
      headers: { 'Content-Type': input.contentType },
    });
  }

  createMultipartUpload(): Promise<{ uploadId: string }> {
    return Promise.resolve({ uploadId: 'upload-1' });
  }

  presignUploadPart(input: {
    objectKey: string;
    partNumber: number;
    expiresInSeconds: number;
  }): Promise<PresignedRequest> {
    this.parts.push({
      objectKey: input.objectKey,
      partNumber: input.partNumber,
    });

    return Promise.resolve({
      url: `https://storage.test/${input.objectKey}/${input.partNumber}`,
      method: 'PUT' as const,
      expiresInSeconds: input.expiresInSeconds,
      headers: {},
    });
  }

  completeMultipartUpload(input: {
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
    return Promise.resolve(this.stored.get(objectKey) ?? null);
  }

  putObject(input: {
    objectKey: string;
    contentType: string;
  }): Promise<StoredObject> {
    const stored: StoredObject = {
      contentType: input.contentType,
      contentLength: 1_024,
      etag: '"etag"',
    };
    this.stored.set(input.objectKey, stored);
    return Promise.resolve(stored);
  }

  deleteObject(objectKey: string): Promise<void> {
    this.deleted.push(objectKey);
    this.stored.delete(objectKey);
    return Promise.resolve();
  }
}

const citizen: StorageActor = { id: 'user-1', role: UserRole.CITIZEN };
const otherCitizen: StorageActor = { id: 'user-2', role: UserRole.CITIZEN };
const admin: StorageActor = { id: 'admin-1', role: UserRole.ADMIN };

describe('StorageService', () => {
  let storage: FakeObjectStorage;
  let service: StorageService;

  beforeEach(() => {
    storage = new FakeObjectStorage();
    service = new StorageService(storage);
  });

  it('presigns a single upload for a small photo', async () => {
    const result = await service.presignUpload(
      { contentType: 'image/jpeg', contentLength: 2_048 },
      citizen,
    );

    expect(result.objectKey).toMatch(
      /^leaks\/user-1\/\d{4}\/\d{2}\/[\w-]+\.jpg$/,
    );
    expect(result.uploadUrl).toContain(result.objectKey);
    expect(result.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(result.multipart).toBeNull();
    expect(storage.uploads).toHaveLength(1);
  });

  it('normalises the content type before signing', async () => {
    const result = await service.presignUpload(
      { contentType: 'Image/PNG; charset=binary', contentLength: 100 },
      citizen,
    );

    expect(result.objectKey.endsWith('.png')).toBe(true);
    expect(result.headers['Content-Type']).toBe('image/png');
  });

  it('rejects unsupported content types', async () => {
    await expect(
      service.presignUpload(
        { contentType: 'application/pdf', contentLength: 100 },
        citizen,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.uploads).toHaveLength(0);
  });

  it('rejects an empty or oversized photo', async () => {
    await expect(
      service.presignUpload(
        { contentType: 'image/jpeg', contentLength: 0 },
        citizen,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.presignUpload(
        { contentType: 'image/jpeg', contentLength: MAX_IMAGE_BYTES + 1 },
        citizen,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('presigns every part of a large photo', async () => {
    const result = await service.presignUpload(
      { contentType: 'image/png', contentLength: MIN_MULTIPART_BYTES * 2 },
      citizen,
    );

    expect(result.multipart?.uploadId).toBe('upload-1');
    expect(result.multipart?.parts.map((part) => part.partNumber)).toEqual([
      1, 2,
    ]);
    expect(storage.parts.map((part) => part.partNumber)).toEqual([1, 2]);
    expect(result.multipart?.objectKey).toBe(result.objectKey);
  });

  it('joins the parts when a multipart upload is completed', async () => {
    await service.completeUpload(
      {
        objectKey: 'leaks/user-1/2026/03/photo.png',
        uploadId: 'upload-1',
        parts: [
          { partNumber: 2, etag: 'b' },
          { partNumber: 1, etag: 'a' },
        ],
      },
      citizen,
    );

    expect(storage.completed).toHaveLength(1);
  });

  it('refuses to complete or abort another account upload', async () => {
    await expect(
      service.completeUpload(
        { objectKey: 'leaks/user-2/2026/03/photo.png' },
        citizen,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.abortUpload(
        { objectKey: 'leaks/user-2/2026/03/photo.png', uploadId: 'upload-1' },
        citizen,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(storage.aborted).toHaveLength(0);
  });

  it('allows reviewers to read but not change another account upload', async () => {
    const objectKey = 'leaks/user-1/2026/03/photo.png';

    await expect(
      service.completeUpload({ objectKey }, admin),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.abortUpload({ objectKey, uploadId: 'upload-1' }, admin),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.deleteObject(objectKey, admin)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(storage.completed).toHaveLength(0);
    expect(storage.aborted).toHaveLength(0);
    expect(storage.deleted).toHaveLength(0);
  });

  it('requires both upload ID and parts to complete multipart uploads', async () => {
    const objectKey = 'leaks/user-1/2026/03/photo.png';

    await expect(
      service.completeUpload({ objectKey, uploadId: 'upload-1' }, citizen),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.completeUpload(
        { objectKey, parts: [{ partNumber: 1, etag: 'etag' }] },
        citizen,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.completed).toHaveLength(0);
  });

  it('lets the owner and reviewers read a photo', async () => {
    const ownerDownload = await service.presignDownload(
      'leaks/user-1/2026/03/photo.jpg',
      citizen,
    );
    expect(ownerDownload.url).toContain('photo.jpg');

    const reviewerDownload = await service.presignDownload(
      'leaks/user-1/2026/03/photo.jpg',
      admin,
    );
    expect(reviewerDownload.url).toContain('photo.jpg');

    await expect(
      service.presignDownload('leaks/user-1/2026/03/photo.jpg', otherCitizen),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to delete another account photo', async () => {
    await expect(
      service.deleteObject('leaks/user-2/2026/03/photo.jpg', citizen),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.deleted).toHaveLength(0);

    await service.deleteObject('leaks/user-1/2026/03/photo.jpg', citizen);
    expect(storage.deleted).toEqual(['leaks/user-1/2026/03/photo.jpg']);
  });

  it('reports a missing object', async () => {
    await expect(
      service.assertExists('leaks/user-1/2026/03/none.jpg'),
    ).rejects.toBeInstanceOf(NotFoundException);

    storage.stored.set('leaks/user-1/2026/03/there.jpg', {
      contentType: 'image/jpeg',
      contentLength: 12,
    });

    await expect(
      service.assertExists('leaks/user-1/2026/03/there.jpg'),
    ).resolves.toEqual({ contentType: 'image/jpeg', contentLength: 12 });
  });

  it('only attaches a photo to an account that uploaded it', () => {
    expect(() =>
      service.assertCanAttach('leaks/user-1/2026/03/photo.jpg', citizen),
    ).not.toThrow();

    expect(() =>
      service.assertCanAttach('leaks/user-2/2026/03/photo.jpg', citizen),
    ).toThrow(ForbiddenException);

    expect(() =>
      service.assertCanAttach('leaks/user-1/2026/03/../../etc/passwd', citizen),
    ).toThrow(ForbiddenException);
  });

  it('never trusts a client supplied file name', async () => {
    const result = await service.presignUpload(
      {
        contentType: 'image/jpeg',
        contentLength: 512,
        fileName: '../../etc/passwd.jpg',
      },
      citizen,
    );

    expect(result.objectKey).not.toContain('passwd');
    expect(result.objectKey).not.toContain('..');
  });

  it('calls the driver exactly once per operation', async () => {
    const put = vi.spyOn(storage, 'presignUpload');
    await service.presignUpload(
      { contentType: 'image/jpeg', contentLength: 512 },
      citizen,
    );
    expect(put).toHaveBeenCalledTimes(1);
  });
});
