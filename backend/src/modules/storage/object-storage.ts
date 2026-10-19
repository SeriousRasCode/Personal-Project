import type { Readable } from 'node:stream';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export interface PresignedRequest {
  url: string;
  method: 'PUT';
  expiresInSeconds: number;
  headers: Record<string, string>;
}

export interface PresignedDownload {
  url: string;
  expiresInSeconds: number;
}

export interface MultipartPart {
  partNumber: number;
  url: string;
  expiresInSeconds: number;
}

export interface MultipartUpload {
  uploadId: string;
  objectKey: string;
  parts: MultipartPart[];
  expiresInSeconds: number;
}

export interface StoredObject {
  contentType: string;
  contentLength?: number;
  etag?: string;
}

export interface ObjectStorage {
  presignUpload(input: {
    objectKey: string;
    contentType: string;
    contentLength?: number;
    expiresInSeconds: number;
  }): Promise<PresignedRequest>;

  createMultipartUpload(input: {
    objectKey: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<{ uploadId: string }>;

  presignUploadPart(input: {
    objectKey: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds: number;
  }): Promise<PresignedRequest>;

  completeMultipartUpload(input: {
    objectKey: string;
    uploadId: string;
    parts: { partNumber: number; etag: string }[];
  }): Promise<void>;

  abortMultipartUpload(input: {
    objectKey: string;
    uploadId: string;
  }): Promise<void>;

  presignDownload(input: {
    objectKey: string;
    expiresInSeconds: number;
  }): Promise<PresignedDownload>;

  headObject(objectKey: string): Promise<StoredObject | null>;

  putObject(input: {
    objectKey: string;
    body: string | Buffer | Readable;
    contentType: string;
  }): Promise<StoredObject>;

  deleteObject(objectKey: string): Promise<void>;
}
