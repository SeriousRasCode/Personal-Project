import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '../../generated/prisma/enums.js';
import type { MultipartUpload, ObjectStorage } from './object-storage.js';
import { OBJECT_STORAGE } from './object-storage.js';
import {
  MAX_IMAGE_BYTES,
  STORAGE_DOWNLOAD_TTL_SECONDS,
  STORAGE_PRESIGN_TTL_SECONDS,
  buildObjectKey,
  isAllowedImageContentType,
  isOwnedObjectKey,
  multipartPartCount,
} from './storage-policy.js';

export interface PresignUploadResult {
  objectKey: string;
  uploadUrl: string;
  method: 'PUT';
  expiresInSeconds: number;
  headers: Record<string, string>;
  multipart: MultipartUpload | null;
}

export interface CompleteUploadResult {
  objectKey: string;
}

const REVIEWER_ROLES: readonly UserRole[] = [
  UserRole.DISPATCHER,
  UserRole.ADMIN,
  UserRole.FIELD_TECHNICIAN,
];

export interface StorageActor {
  id: string;
  role: UserRole;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async presignUpload(
    input: { contentType: string; contentLength: number; fileName?: string },
    user: StorageActor,
  ): Promise<PresignUploadResult> {
    const contentType =
      input.contentType.toLowerCase().split(';')[0]?.trim() ?? '';

    if (!isAllowedImageContentType(contentType)) {
      throw new BadRequestException(
        'Only JPEG, PNG, WebP, and HEIC photos are accepted',
      );
    }

    if (input.contentLength <= 0) {
      throw new BadRequestException('contentLength must be greater than zero');
    }

    if (input.contentLength > MAX_IMAGE_BYTES) {
      throw new BadRequestException(
        `Photos must be ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB or smaller`,
      );
    }

    const objectKey = buildObjectKey({
      ownerId: user.id,
      now: new Date(),
      randomId: randomUUID(),
      contentType,
    });

    const partCount = multipartPartCount(input.contentLength);

    if (partCount === 1) {
      const request = await this.storage.presignUpload({
        objectKey,
        contentType,
        contentLength: input.contentLength,
        expiresInSeconds: STORAGE_PRESIGN_TTL_SECONDS,
      });

      this.logger.debug(`Presigned single upload for ${objectKey}`);

      return {
        objectKey,
        uploadUrl: request.url,
        method: 'PUT',
        expiresInSeconds: request.expiresInSeconds,
        headers: request.headers,
        multipart: null,
      };
    }

    const { uploadId } = await this.storage.createMultipartUpload({
      objectKey,
      contentType,
      expiresInSeconds: STORAGE_PRESIGN_TTL_SECONDS,
    });

    const parts = await Promise.all(
      Array.from({ length: partCount }, async (_unused, index) => {
        const partNumber = index + 1;
        const request = await this.storage.presignUploadPart({
          objectKey,
          uploadId,
          partNumber,
          expiresInSeconds: STORAGE_PRESIGN_TTL_SECONDS,
        });

        return {
          partNumber,
          url: request.url,
          expiresInSeconds: request.expiresInSeconds,
        };
      }),
    );

    this.logger.debug(`Presigned ${partCount} part upload for ${objectKey}`);

    return {
      objectKey,
      uploadUrl: '',
      method: 'PUT',
      expiresInSeconds: STORAGE_PRESIGN_TTL_SECONDS,
      headers: { 'Content-Type': contentType },
      multipart: {
        uploadId,
        objectKey,
        parts,
        expiresInSeconds: STORAGE_PRESIGN_TTL_SECONDS,
      },
    };
  }

  async completeUpload(
    input: {
      objectKey: string;
      uploadId?: string;
      parts?: { partNumber: number; etag: string }[];
    },
    user: StorageActor,
  ): Promise<CompleteUploadResult> {
    this.assertCanAttach(input.objectKey, user);

    if (Boolean(input.uploadId) !== Boolean(input.parts?.length)) {
      throw new BadRequestException(
        'uploadId and parts must be supplied together for multipart uploads',
      );
    }

    if (input.uploadId && input.parts?.length) {
      await this.storage.completeMultipartUpload({
        objectKey: input.objectKey,
        uploadId: input.uploadId,
        parts: input.parts,
      });
    }

    return { objectKey: input.objectKey };
  }

  async abortUpload(
    input: { objectKey: string; uploadId: string },
    user: StorageActor,
  ): Promise<{ aborted: true }> {
    this.assertCanAttach(input.objectKey, user);
    await this.storage.abortMultipartUpload(input);
    return { aborted: true };
  }

  async presignDownload(
    objectKey: string,
    user: StorageActor,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    this.assertReadable(objectKey, user);

    const download = await this.storage.presignDownload({
      objectKey,
      expiresInSeconds: STORAGE_DOWNLOAD_TTL_SECONDS,
    });

    return download;
  }

  async deleteObject(
    objectKey: string,
    user: StorageActor,
  ): Promise<{ deleted: true }> {
    this.assertCanAttach(objectKey, user);
    await this.storage.deleteObject(objectKey);
    this.logger.debug(`Deleted ${objectKey}`);
    return { deleted: true };
  }

  async assertExists(objectKey: string): Promise<StoredObjectSummary> {
    const object = await this.storage.headObject(objectKey);

    if (!object) {
      throw new NotFoundException('The uploaded photo was not found');
    }

    return {
      contentType: object.contentType,
      contentLength: object.contentLength ?? null,
    };
  }

  assertCanAttach(objectKey: string, user: StorageActor): void {
    if (!isOwnedObjectKey(objectKey, user.id)) {
      throw new ForbiddenException(
        'That photo was uploaded by a different account',
      );
    }
  }

  private assertReadable(objectKey: string, user: StorageActor): void {
    if (
      REVIEWER_ROLES.includes(user.role) ||
      isOwnedObjectKey(objectKey, user.id)
    ) {
      return;
    }

    throw new ForbiddenException('That photo belongs to a different account');
  }
}

export interface StoredObjectSummary {
  contentType: string;
  contentLength: number | null;
}
