import type { UserRole, UserStatus } from '../../generated/prisma/enums.js';

export interface AuthenticatedUser {
  id: string;
  phone: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  locale: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AuthUser = AuthenticatedUser;

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  sid: string;
  iat?: number;
  exp?: number;
}

export interface RequestContext {
  requestId?: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface SessionContext {
  userAgent?: string;
  ipAddress?: string;
}
