import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { AuditEvent } from '../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';

export interface AuditActor {
  id: string;
}

export interface AuditRecordInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  requestId?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown> | null;
  actorId?: string | null;
}

export interface AuditRequestLike {
  id?: string;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}

const sensitiveKeyPattern =
  /(password|passcode|token|secret|authorization|otp|code)/i;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    input: AuditRecordInput,
    actor?: AuthenticatedUser | AuditActor | null,
  ): Promise<AuditEvent> {
    const actorId = input.actorId ?? actor?.id ?? null;
    const metadata = input.metadata
      ? this.sanitizeMetadata(input.metadata)
      : undefined;

    return this.prisma.auditEvent.create({
      data: {
        actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        requestId: input.requestId ?? null,
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
        ...(metadata === undefined ? {} : { metadata }),
      },
    });
  }

  async recordFromRequest(
    input: AuditRecordInput,
    request: AuditRequestLike | undefined,
    actor?: AuthenticatedUser | AuditActor | null,
  ): Promise<AuditEvent> {
    const userAgentHeader = request?.headers?.['user-agent'];
    const userAgent = Array.isArray(userAgentHeader)
      ? userAgentHeader[0]
      : userAgentHeader;

    return this.record(
      {
        ...input,
        requestId: input.requestId ?? request?.id ?? null,
        userAgent: input.userAgent ?? userAgent ?? null,
        ipAddress: input.ipAddress ?? request?.ip ?? null,
      },
      actor,
    );
  }

  sanitizeMetadata(value: unknown, depth = 0): Prisma.InputJsonValue {
    if (depth > 5) {
      return '[TRUNCATED]';
    }

    if (value === null) {
      return '[NULL]';
    }

    if (typeof value === 'string' || typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : '[NON_FINITE]';
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeMetadata(item, depth + 1));
    }

    if (typeof value === 'object') {
      const sanitized: Record<string, Prisma.InputJsonValue> = {};
      for (const [key, item] of Object.entries(value)) {
        sanitized[key] = sensitiveKeyPattern.test(key)
          ? '[REDACTED]'
          : this.sanitizeMetadata(item, depth + 1);
      }
      return sanitized;
    }

    if (
      typeof value === 'bigint' ||
      typeof value === 'symbol' ||
      typeof value === 'function'
    ) {
      return value.toString();
    }

    return '[UNSUPPORTED]';
  }
}
