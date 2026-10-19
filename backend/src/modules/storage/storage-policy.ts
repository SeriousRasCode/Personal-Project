export const STORAGE_PRESIGN_TTL_SECONDS = 900;

export const STORAGE_DOWNLOAD_TTL_SECONDS = 300;

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const MIN_MULTIPART_BYTES = 5 * 1024 * 1024;

export const MAX_MULTIPART_PARTS = 10_000;

export const MAX_PHOTO_CONTENT_LENGTH = 20 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const;

const ALLOWED_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

export function isAllowedImageContentType(
  contentType: string,
): contentType is (typeof ALLOWED_IMAGE_TYPES)[number] {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(contentType);
}

export function extensionForContentType(contentType: string): string {
  return ALLOWED_EXTENSIONS[contentType] ?? 'bin';
}

export interface ObjectKeyParts {
  ownerId: string;
  now: Date;
  randomId: string;
  contentType: string;
}

export function buildObjectKey(parts: ObjectKeyParts): string {
  const owner = sanitiseSegment(parts.ownerId);
  const year = parts.now.getUTCFullYear();
  const month = String(parts.now.getUTCMonth() + 1).padStart(2, '0');

  return `leaks/${owner}/${year}/${month}/${parts.randomId}.${extensionForContentType(parts.contentType)}`;
}

const OBJECT_FILENAME_PATTERN = /^[\w-]+\.[A-Za-z0-9]+$/;

export function ownerOfObjectKey(objectKey: string): string | null {
  const segments = objectKey.split('/');

  if (
    segments.length !== 5 ||
    segments[0] !== 'leaks' ||
    !OBJECT_FILENAME_PATTERN.test(segments[4])
  ) {
    return null;
  }

  const owner = segments[1];
  return owner && owner !== '.' && owner !== '..' ? owner : null;
}

export function isOwnedObjectKey(objectKey: string, ownerId: string): boolean {
  return ownerOfObjectKey(objectKey) === sanitiseSegment(ownerId);
}

export function sanitiseSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return cleaned.length > 0 ? cleaned : 'unknown';
}

export function multipartPartCount(contentLength: number): number {
  const partSize = MIN_MULTIPART_BYTES;
  return Math.min(
    MAX_MULTIPART_PARTS,
    Math.max(1, Math.ceil(contentLength / partSize)),
  );
}
