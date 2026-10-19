import { describe, expect, it } from 'vitest';
import {
  buildObjectKey,
  extensionForContentType,
  isAllowedImageContentType,
  isOwnedObjectKey,
  multipartPartCount,
  ownerOfObjectKey,
  sanitiseSegment,
  MAX_IMAGE_BYTES,
  MIN_MULTIPART_BYTES,
} from './storage-policy.js';

describe('storage policy', () => {
  it('accepts only the supported image types', () => {
    expect(isAllowedImageContentType('image/jpeg')).toBe(true);
    expect(isAllowedImageContentType('image/png')).toBe(true);
    expect(isAllowedImageContentType('image/webp')).toBe(true);
    expect(isAllowedImageContentType('image/heic')).toBe(true);
    expect(isAllowedImageContentType('image/svg+xml')).toBe(false);
    expect(isAllowedImageContentType('application/pdf')).toBe(false);
    expect(isAllowedImageContentType('text/html')).toBe(false);
  });

  it('maps content types to file extensions', () => {
    expect(extensionForContentType('image/jpeg')).toBe('jpg');
    expect(extensionForContentType('image/png')).toBe('png');
    expect(extensionForContentType('image/webp')).toBe('webp');
    expect(extensionForContentType('image/heic')).toBe('heic');
    expect(extensionForContentType('application/octet-stream')).toBe('bin');
  });

  it('builds an owner scoped key grouped by month', () => {
    const key = buildObjectKey({
      ownerId: 'user-1',
      now: new Date('2026-03-04T10:30:00Z'),
      randomId: 'abc-123',
      contentType: 'image/jpeg',
    });

    expect(key).toBe('leaks/user-1/2026/03/abc-123.jpg');
  });

  it('strips path characters from the owner segment', () => {
    expect(sanitiseSegment('../../etc')).toBe('etc');
    expect(sanitiseSegment('a/b')).toBe('ab');
    expect(sanitiseSegment('..')).toBe('unknown');
    expect(sanitiseSegment('')).toBe('unknown');

    const key = buildObjectKey({
      ownerId: '../../etc/passwd',
      now: new Date('2026-01-01T00:00:00Z'),
      randomId: 'id',
      contentType: 'image/png',
    });

    expect(key).toBe('leaks/etcpasswd/2026/01/id.png');
    expect(key.startsWith('leaks/')).toBe(true);
    expect(key).not.toContain('..');
  });

  it('reads the owner back out of a key', () => {
    expect(ownerOfObjectKey('leaks/user-1/2026/03/abc.jpg')).toBe('user-1');
    expect(ownerOfObjectKey('leaks/user-1/2026/03/abc')).toBeNull();
    expect(ownerOfObjectKey('leaks/user-1/2026/03/abc.jpg/extra')).toBeNull();
    expect(ownerOfObjectKey('leaks/user-1/2026/03/..jpg')).toBeNull();
    expect(ownerOfObjectKey('leaks//2026/03/abc.jpg')).toBeNull();
    expect(ownerOfObjectKey('reports/user-1/2026/03/abc.jpg')).toBeNull();
    expect(ownerOfObjectKey('leaks/../2026/03/abc.jpg')).toBeNull();
    expect(ownerOfObjectKey('not-a-key')).toBeNull();
  });

  it('only matches keys belonging to the owner', () => {
    expect(isOwnedObjectKey('leaks/user-1/2026/03/abc.jpg', 'user-1')).toBe(
      true,
    );
    expect(isOwnedObjectKey('leaks/user-2/2026/03/abc.jpg', 'user-1')).toBe(
      false,
    );
    expect(isOwnedObjectKey('leaks/user-1/2026/03/abc.jpg', 'user-2')).toBe(
      false,
    );
    expect(
      isOwnedObjectKey('leaks/user-1/2026/03/abc.jpg/extra', 'user-1'),
    ).toBe(false);
  });

  it('keeps small uploads on a single request and splits large ones', () => {
    expect(multipartPartCount(1_024)).toBe(1);
    expect(multipartPartCount(MIN_MULTIPART_BYTES)).toBe(1);
    expect(multipartPartCount(MIN_MULTIPART_BYTES + 1)).toBe(2);
    expect(multipartPartCount(MIN_MULTIPART_BYTES * 3)).toBe(3);
    expect(multipartPartCount(MAX_IMAGE_BYTES)).toBe(2);
  });
});
