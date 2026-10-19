import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  ObjectStorage,
  PresignedDownload,
  PresignedRequest,
  StoredObject,
} from './object-storage.js';

export interface S3StorageOptions {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private ensuredBucket = false;

  constructor(private readonly options: S3StorageOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      credentials: {
        accessKeyId: options.accessKey,
        secretAccessKey: options.secretKey,
      },
    });
  }

  async ensureBucket(): Promise<void> {
    if (this.ensuredBucket) {
      return;
    }

    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    this.ensuredBucket = true;
  }

  async presignUpload(input: {
    objectKey: string;
    contentType: string;
    contentLength?: number;
    expiresInSeconds: number;
  }): Promise<PresignedRequest> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.objectKey,
      ContentType: input.contentType,
      ...(input.contentLength === undefined
        ? {}
        : { ContentLength: input.contentLength }),
    });

    return {
      url: await getSignedUrl(this.client, command, {
        expiresIn: input.expiresInSeconds,
      }),
      method: 'PUT',
      expiresInSeconds: input.expiresInSeconds,
      headers: { 'Content-Type': input.contentType },
    };
  }

  async createMultipartUpload(input: {
    objectKey: string;
    contentType: string;
  }): Promise<{ uploadId: string }> {
    const response = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        ContentType: input.contentType,
      }),
    );

    if (!response.UploadId) {
      throw new Error(`S3 did not return an upload id for ${input.objectKey}`);
    }

    return { uploadId: response.UploadId };
  }

  async presignUploadPart(input: {
    objectKey: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds: number;
  }): Promise<PresignedRequest> {
    const command = new UploadPartCommand({
      Bucket: this.bucket,
      Key: input.objectKey,
      UploadId: input.uploadId,
      PartNumber: input.partNumber,
    });

    return {
      url: await getSignedUrl(this.client, command, {
        expiresIn: input.expiresInSeconds,
      }),
      method: 'PUT',
      expiresInSeconds: input.expiresInSeconds,
      headers: {},
    };
  }

  async completeMultipartUpload(input: {
    objectKey: string;
    uploadId: string;
    parts: { partNumber: number; etag: string }[];
  }): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        UploadId: input.uploadId,
        MultipartUpload: {
          Parts: [...input.parts]
            .sort((left, right) => left.partNumber - right.partNumber)
            .map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
        },
      }),
    );
  }

  async abortMultipartUpload(input: {
    objectKey: string;
    uploadId: string;
  }): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        UploadId: input.uploadId,
      }),
    );
  }

  async presignDownload(input: {
    objectKey: string;
    expiresInSeconds: number;
  }): Promise<PresignedDownload> {
    return {
      url: await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: input.objectKey }),
        { expiresIn: input.expiresInSeconds },
      ),
      expiresInSeconds: input.expiresInSeconds,
    };
  }

  async headObject(objectKey: string): Promise<StoredObject | null> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );

      return {
        contentType: response.ContentType ?? 'application/octet-stream',
        ...(response.ContentLength === undefined
          ? {}
          : { contentLength: response.ContentLength }),
        ...(response.ETag === undefined ? {} : { etag: response.ETag }),
      };
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }

      throw error;
    }
  }

  async putObject(input: {
    objectKey: string;
    body: string | Buffer;
    contentType: string;
  }): Promise<StoredObject> {
    const response = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );

    return {
      contentType: input.contentType,
      ...(response.ETag === undefined ? {} : { etag: response.ETag }),
    };
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };

  return (
    candidate.name === 'NotFound' ||
    candidate.name === 'NoSuchKey' ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

export function createS3ObjectStorage(
  configService: ConfigService,
): S3ObjectStorage {
  return new S3ObjectStorage({
    endpoint: configService.get<string>('storage.endpoint'),
    region: configService.get<string>('storage.region') ?? 'us-east-1',
    bucket: configService.get<string>('storage.bucket') ?? 'hydrojimma',
    accessKey: configService.get<string>('storage.accessKey') ?? 'test',
    secretKey: configService.get<string>('storage.secretKey') ?? 'test',
    forcePathStyle:
      configService.get<boolean>('storage.forcePathStyle') ?? true,
  });
}
