import { describe, it, expect, vi } from 'vitest';
import { UssdController } from './ussd.controller.js';
import { signCallback } from './ussd-signature.js';
describe('USSD callback raw-body signatures', () => {
  const secret = 'local-test-secret';
  const body = { sessionKey: 'qa-session', phone: '+251900000104', input: '' };
  it('verifies the actual provider bytes, including JSON whitespace', async () => {
    const timestamp = new Date().toISOString(),
      raw = JSON.stringify(body, null, 2);
    const handleCallback = vi
      .fn()
      .mockResolvedValue({ message: 'Water service', done: false });
    const controller = new UssdController(
      { handleCallback } as never,
      { get: () => secret } as never,
      {} as never,
    );
    await expect(
      controller.callback(
        { body, rawBody: Buffer.from(raw) } as never,
        timestamp,
        signCallback(secret, timestamp, raw),
        body,
      ),
    ).resolves.toMatchObject({ message: 'Water service' });
    expect(handleCallback).toHaveBeenCalledWith(body);
  });
  it('rejects signatures calculated for different bytes', async () => {
    const timestamp = new Date().toISOString();
    const handleCallback = vi.fn();
    const controller = new UssdController(
      { handleCallback } as never,
      { get: () => secret } as never,
      {} as never,
    );
    await expect(
      controller.callback(
        { body, rawBody: Buffer.from(JSON.stringify(body, null, 2)) } as never,
        timestamp,
        signCallback(secret, timestamp, JSON.stringify(body)),
        body,
      ),
    ).rejects.toThrow('Invalid USSD callback signature');
    expect(handleCallback).not.toHaveBeenCalled();
  });
});
