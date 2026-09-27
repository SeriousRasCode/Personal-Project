import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { UserRole, UserStatus } from '../../generated/prisma/enums.js';
import type { UserGetPayload } from '../../generated/prisma/models/User.js';
import { PrismaService } from '../../database/prisma.service.js';
import { PasswordService } from '../../common/auth/password.service.js';
import { normalizePhone, isValidPhone } from '../../common/auth/phone.util.js';
import type {
  AuthenticatedUser,
  RequestContext,
} from '../../common/types/authenticated-user.js';
import { AuditService } from '../audit/audit.service.js';
import type { PageResult } from '../../common/dto/pagination.dto.js';
import type { ListUsersDto } from './dto/list-users.dto.js';
import type { CreateStaffUserDto } from './dto/create-staff-user.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';
import type { UpdateUserStatusDto } from './dto/update-user-status.dto.js';

type UserTransactionClient = Prisma.TransactionClient;

export const PUBLIC_USER_SELECT = {
  id: true,
  phone: true,
  displayName: true,
  role: true,
  status: true,
  locale: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const AUTHENTICATION_USER_SELECT = {
  ...PUBLIC_USER_SELECT,
  passwordHash: true,
} as const;

export type PublicUser = UserGetPayload<{
  select: typeof PUBLIC_USER_SELECT;
}>;

export type AuthenticationUser = UserGetPayload<{
  select: typeof AUTHENTICATION_USER_SELECT;
}>;

export interface CreateCitizenInput {
  phone: string;
  displayName: string;
  password: string;
  locale?: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  async createCitizen(
    input: CreateCitizenInput,
    actor?: AuthenticatedUser | null,
  ): Promise<PublicUser> {
    const phone = normalizePhone(input.phone);
    const passwordHash = await this.passwordService.hash(input.password);

    try {
      const user = await this.prisma.user.create({
        data: {
          phone,
          displayName: input.displayName.trim(),
          passwordHash,
          role: UserRole.CITIZEN,
          status: UserStatus.PENDING_VERIFICATION,
          locale: this.locale(input.locale),
        },
        select: PUBLIC_USER_SELECT,
      });
      await this.recordAudit(
        'identity.user.registered',
        'User',
        user.id,
        { role: user.role },
        actor,
      );
      return user;
    } catch (error: unknown) {
      if (this.isPrismaCode(error, 'P2002')) {
        throw new ConflictException('Phone number is already registered');
      }
      throw error;
    }
  }

  async createStaff(
    input: CreateStaffUserDto,
    actor?: AuthenticatedUser | null,
  ): Promise<PublicUser> {
    this.assertStaffRole(input.role);
    const phone = normalizePhone(input.phone);
    const passwordHash = await this.passwordService.hash(input.password);

    try {
      const user = await this.prisma.user.create({
        data: {
          phone,
          displayName: input.displayName.trim(),
          passwordHash,
          role: input.role,
          status: input.status ?? UserStatus.ACTIVE,
          locale: this.locale(input.locale),
        },
        select: PUBLIC_USER_SELECT,
      });
      await this.recordAudit(
        'identity.user.staff_created',
        'User',
        user.id,
        { role: user.role },
        actor,
      );
      return user;
    } catch (error: unknown) {
      if (this.isPrismaCode(error, 'P2002')) {
        throw new ConflictException('Phone number is already registered');
      }
      throw error;
    }
  }

  async findForAuthentication(
    phone: string,
  ): Promise<AuthenticationUser | null> {
    if (!isValidPhone(phone)) {
      return null;
    }

    return this.prisma.user.findUnique({
      where: { phone: normalizePhone(phone) },
      select: AUTHENTICATION_USER_SELECT,
    });
  }

  async findById(id: string): Promise<PublicUser | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: PUBLIC_USER_SELECT,
    });
  }

  async findActiveById(
    id: string,
    sessionId?: string,
  ): Promise<PublicUser | null> {
    const user = await this.prisma.user.findFirst({
      where: { id, status: UserStatus.ACTIVE },
      select: PUBLIC_USER_SELECT,
    });

    if (!user || !sessionId) {
      return user;
    }

    const session = await this.prisma.refreshSession.findFirst({
      where: {
        id: sessionId,
        userId: id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });

    return session ? user : null;
  }

  async touchLastLogin(id: string): Promise<PublicUser> {
    return this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
      select: PUBLIC_USER_SELECT,
    });
  }

  async list(query: ListUsersDto): Promise<PageResult<PublicUser>> {
    const where: Prisma.UserWhereInput = {};
    if (query.role) {
      where.role = query.role;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { displayName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: PUBLIC_USER_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async update(
    id: string,
    input: UpdateUserDto,
    actor?: AuthenticatedUser | null,
  ): Promise<PublicUser> {
    if (
      input.phone === undefined &&
      input.displayName === undefined &&
      input.password === undefined &&
      input.role === undefined &&
      input.locale === undefined
    ) {
      throw new BadRequestException('At least one user field is required');
    }

    if (input.role !== undefined) {
      this.assertStaffRole(input.role);
    }

    const data: Prisma.UserUpdateInput = {};
    if (input.phone !== undefined) {
      data.phone = normalizePhone(input.phone);
    }
    if (input.displayName !== undefined) {
      data.displayName = input.displayName.trim();
    }
    if (input.password !== undefined) {
      data.passwordHash = await this.passwordService.hash(input.password);
    }
    if (input.role !== undefined) {
      data.role = input.role;
    }
    if (input.locale !== undefined) {
      data.locale = this.locale(input.locale);
    }

    try {
      const user = await this.runTransaction(async (transaction) => {
        const updated = await transaction.user.update({
          where: { id },
          data,
          select: PUBLIC_USER_SELECT,
        });
        const now = new Date();

        if (
          input.password !== undefined ||
          input.phone !== undefined ||
          input.role !== undefined
        ) {
          await transaction.refreshSession.updateMany({
            where: { userId: id, revokedAt: null },
            data: { revokedAt: now },
          });
        }

        if (input.phone !== undefined) {
          await transaction.otpChallenge.updateMany({
            where: {
              userId: id,
              consumedAt: null,
              expiresAt: { gt: now },
            },
            data: { consumedAt: now },
          });
        }

        return updated;
      });

      await this.recordAudit(
        'identity.user.updated',
        'User',
        user.id,
        { fields: Object.keys(input) },
        actor,
      );
      return user;
    } catch (error: unknown) {
      if (this.isPrismaCode(error, 'P2025')) {
        throw new NotFoundException('User not found');
      }
      if (this.isPrismaCode(error, 'P2002')) {
        throw new ConflictException('Phone number is already registered');
      }
      throw error;
    }
  }

  async updateStatus(
    id: string,
    input: UpdateUserStatusDto,
    actor?: AuthenticatedUser | null,
  ): Promise<PublicUser> {
    try {
      const user = await this.runTransaction(async (transaction) => {
        const updated = await transaction.user.update({
          where: { id },
          data: { status: input.status },
          select: PUBLIC_USER_SELECT,
        });
        const now = new Date();
        await transaction.refreshSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: now },
        });
        await transaction.otpChallenge.updateMany({
          where: {
            userId: id,
            consumedAt: null,
            expiresAt: { gt: now },
          },
          data: { consumedAt: now },
        });
        return updated;
      });

      await this.recordAudit(
        'identity.user.status_changed',
        'User',
        user.id,
        { status: user.status },
        actor,
      );
      return user;
    } catch (error: unknown) {
      if (this.isPrismaCode(error, 'P2025')) {
        throw new NotFoundException('User not found');
      }
      throw error;
    }
  }

  private runTransaction<T>(
    callback: (client: UserTransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(callback);
  }

  private assertStaffRole(role: UserRole): void {
    if (role === UserRole.CITIZEN) {
      throw new BadRequestException('Staff users must have a staff role');
    }
  }

  private locale(value: string | undefined): string {
    return value?.trim() || 'en';
  }

  private async recordAudit(
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
    actor?: AuthenticatedUser | null,
    context?: RequestContext,
  ): Promise<void> {
    if (!this.auditService) {
      return;
    }

    try {
      await this.auditService.record(
        {
          action,
          entityType,
          entityId,
          metadata,
          requestId: context?.requestId,
          userAgent: context?.userAgent,
          ipAddress: context?.ipAddress,
        },
        actor,
      );
    } catch {
      return;
    }
  }

  private isPrismaCode(error: unknown, code: string): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return error.code === code;
    }
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === code
    );
  }
}
