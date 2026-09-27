import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { UserRole, UserStatus } from '../../generated/prisma/enums.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

const actor: AuthenticatedUser = {
  id: 'user-1',
  phone: '+251900000000',
  displayName: 'Hydro User',
  role: UserRole.CITIZEN,
  status: UserStatus.ACTIVE,
  locale: 'en',
  lastLoginAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthController', () => {
  it('passes an authenticated actor to logout auditing', async () => {
    const logout = vi.fn().mockResolvedValue({ loggedOut: true });
    const controller = new AuthController({ logout } as unknown as AuthService);
    const request = {
      id: 'request-1',
      ip: '127.0.0.1',
      headers: { 'user-agent': 'test-agent' },
    } as unknown as FastifyRequest;

    await controller.logout({ refreshToken: 'refresh-token' }, request, actor);

    expect(logout).toHaveBeenCalledWith(
      { refreshToken: 'refresh-token' },
      actor,
      {
        requestId: 'request-1',
        userAgent: 'test-agent',
        ipAddress: '127.0.0.1',
      },
    );
  });
});
