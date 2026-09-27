import { describe, expect, it } from 'vitest';
import {
  PASSWORD_POLICY_MESSAGE,
  PasswordService,
} from './password.service.js';

describe('PasswordService', () => {
  it('rejects passwords that do not satisfy the policy', async () => {
    const service = new PasswordService();

    await expect(service.hash('weakpassword')).rejects.toThrow(
      PASSWORD_POLICY_MESSAGE,
    );
    expect(service.isStrongPassword('HydroJimma!2026')).toBe(true);
    expect(service.isStrongPassword('HydroJimma2026')).toBe(false);
  });

  it('hashes and verifies a strong password', async () => {
    const service = new PasswordService();
    const password = 'HydroJimma!2026';

    const passwordHash = await service.hash(password);

    expect(passwordHash).toMatch(/^\$argon2id\$/);
    await expect(service.verify(passwordHash, password)).resolves.toBe(true);
    await expect(service.verify(passwordHash, 'HydroJimma!2025')).resolves.toBe(
      false,
    );
  });

  it('hashes and verifies six-digit OTP codes', async () => {
    const service = new PasswordService();
    const codeHash = await service.hashOtp('123456');

    await expect(service.verifyOtp(codeHash, '123456')).resolves.toBe(true);
    await expect(service.verifyOtp(codeHash, '12345')).resolves.toBe(false);
    await expect(service.hashOtp('12345')).rejects.toThrow(
      'OTP must contain six digits',
    );
  });
});
