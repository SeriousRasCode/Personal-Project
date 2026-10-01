import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SmsService } from './sms.service.js';

const configFor = (values: Record<string, unknown>): ConfigService =>
  ({
    get: (key: string) => {
      if (key in values) {
        return values[key];
      }
      return key.split('.').reduce<unknown>((current, part) => {
        if (
          typeof current === 'object' &&
          current !== null &&
          part in (current as Record<string, unknown>)
        ) {
          return (current as Record<string, unknown>)[part];
        }
        return undefined;
      }, values);
    },
  }) as unknown as ConfigService;

describe('SmsService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to the log provider', () => {
    const service = new SmsService(configFor({}));
    expect(service.providerName).toBe('log');
  });

  it('sends through the log provider', async () => {
    const service = new SmsService(configFor({ sms: { provider: 'log' } }));
    await expect(
      service.send({ to: '+251911000000', body: 'hello' }),
    ).resolves.toBeUndefined();
  });

  it('falls back to the log provider when http is not configured', () => {
    const service = new SmsService(
      configFor({
        sms: { provider: 'http', apiUrl: undefined, apiKey: undefined },
      }),
    );
    expect(service.providerName).toBe('log');
  });

  it('posts to the configured http endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const service = new SmsService(
      configFor({
        sms: {
          provider: 'http',
          apiUrl: 'https://sms.example.test/send',
          apiKey: 'secret-key',
        },
      }),
    );
    expect(service.providerName).toBe('http');

    await service.send({ to: '+251911000000', body: 'code 123456' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sms.example.test/send');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer secret-key',
    );
    expect(JSON.parse(init.body as string)).toEqual({
      to: '+251911000000',
      message: 'code 123456',
    });

    vi.unstubAllGlobals();
  });

  it('rejects when the provider returns an error status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502 });
    vi.stubGlobal('fetch', fetchMock);

    const service = new SmsService(
      configFor({
        sms: {
          provider: 'http',
          apiUrl: 'https://sms.example.test/send',
          apiKey: 'secret-key',
        },
      }),
    );

    await expect(
      service.send({ to: '+251911000000', body: 'hello' }),
    ).rejects.toThrow('502');

    vi.unstubAllGlobals();
  });
});
