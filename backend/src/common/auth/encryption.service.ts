import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const algorithm = 'aes-256-gcm';
const initializationVectorBytes = 12;
const authTagBytes = 16;
const keyBytes = 32;

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(configService: ConfigService) {
    const configuredKey =
      configService.get<string>('encryption.key') ??
      configService.get<string>('DATA_ENCRYPTION_KEY');

    if (!configuredKey) {
      throw new Error('DATA_ENCRYPTION_KEY is not configured');
    }

    this.key = Buffer.from(configuredKey, 'hex');
    if (this.key.length !== keyBytes) {
      throw new Error('DATA_ENCRYPTION_KEY must be 64 hexadecimal characters');
    }
  }

  encrypt(plaintext: string): string {
    const initializationVector = randomBytes(initializationVectorBytes);
    const cipher = createCipheriv(algorithm, this.key, initializationVector, {
      authTagLength: authTagBytes,
    });
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    return [initializationVector, cipher.getAuthTag(), ciphertext]
      .map((part) => part.toString('base64url'))
      .join('.');
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 3) {
      throw new Error('Encrypted payload is malformed');
    }

    const [initializationVector, authTag, ciphertext] = parts.map((part) =>
      Buffer.from(part, 'base64url'),
    );

    if (
      initializationVector.length !== initializationVectorBytes ||
      authTag.length !== authTagBytes
    ) {
      throw new Error('Encrypted payload is malformed');
    }

    const decipher = createDecipheriv(
      algorithm,
      this.key,
      initializationVector,
      { authTagLength: authTagBytes },
    );
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}
