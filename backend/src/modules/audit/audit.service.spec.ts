import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditService } from './audit.service.js';

describe('AuditService', () => {
  it('redacts sensitive metadata recursively before persistence', async () => {
    const create = vi
      .fn()
      .mockImplementation(({ data }: { data: unknown }) =>
        Promise.resolve(data),
      );
    const prisma = {
      auditEvent: { create },
    } as unknown as PrismaService;
    const service = new AuditService(prisma);

    await service.record({
      action: 'identity.test',
      entityType: 'User',
      entityId: 'user-1',
      metadata: {
        password: 'secret',
        nested: { refreshToken: 'token', safe: true },
        value: null,
      },
    });

    const createCall = create.mock.calls[0]?.[0] as
      { data?: { metadata?: unknown } } | undefined;
    expect(createCall?.data?.metadata).toEqual({
      password: '[REDACTED]',
      nested: { refreshToken: '[REDACTED]', safe: true },
      value: '[NULL]',
    });
  });

  it('extracts request metadata when recording from a request-like object', async () => {
    const create = vi
      .fn()
      .mockImplementation(({ data }: { data: unknown }) =>
        Promise.resolve(data),
      );
    const prisma = {
      auditEvent: { create },
    } as unknown as PrismaService;
    const service = new AuditService(prisma);

    await service.recordFromRequest(
      { action: 'identity.test', entityType: 'User' },
      {
        id: 'request-1',
        ip: '127.0.0.1',
        headers: { 'user-agent': 'test-agent' },
      },
    );

    const createCall = create.mock.calls[0]?.[0] as
      { data?: Record<string, unknown> } | undefined;
    expect(createCall?.data?.requestId).toBe('request-1');
    expect(createCall?.data?.userAgent).toBe('test-agent');
    expect(createCall?.data?.ipAddress).toBe('127.0.0.1');
  });
});
