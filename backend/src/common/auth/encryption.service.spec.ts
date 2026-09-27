import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { EncryptionService } from './encryption.service.js';

function serviceWithKey(key: string): EncryptionService {
  const configService = {
    get: (property: string) =>
      property === 'encryption.key' ? key : undefined,
  } as unknown as ConfigService;

  return new EncryptionService(configService);
}

describe('EncryptionService', () => {
  const key = 'a'.repeat(64);

  it('round-trips a plaintext value', () => {
    const service = serviceWithKey(key);
    const ciphertext = service.encrypt('123456');

    expect(ciphertext).not.toContain('123456');
    expect(service.decrypt(ciphertext)).toBe('123456');
  });

  it('produces a unique ciphertext for the same plaintext', () => {
    const service = serviceWithKey(key);

    expect(service.encrypt('123456')).not.toBe(service.encrypt('123456'));
  });

  it('rejects tampered ciphertext', () => {
    const service = serviceWithKey(key);
    const [initializationVector, authTag, ciphertext] = service
      .encrypt('123456')
      .split('.');
    const tampered = [
      initializationVector,
      authTag,
      Buffer.from('123457').toString('base64url'),
    ].join('.');

    expect(ciphertext).toBeDefined();
    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('rejects malformed payloads and invalid keys', () => {
    const service = serviceWithKey(key);

    expect(() => service.decrypt('not-a-payload')).toThrow(
      'Encrypted payload is malformed',
    );
    expect(() => serviceWithKey('not-hex')).toThrow(
      'DATA_ENCRYPTION_KEY must be 64 hexadecimal characters',
    );
  });
});
