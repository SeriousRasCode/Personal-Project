import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '../../generated/prisma/enums.js';
import { RolesGuard } from './roles.guard.js';

function createContext(user?: { role: UserRole }): ExecutionContext {
  return {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows public handlers even when a class has role requirements', () => {
    const reflector = {
      getAllAndOverride: vi
        .fn()
        .mockReturnValueOnce(true)
        .mockReturnValueOnce([UserRole.ADMIN]),
    } as never;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(createContext())).toBe(true);
  });

  it('rejects authenticated users without a required role', () => {
    const reflector = {
      getAllAndOverride: vi
        .fn()
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce([UserRole.ADMIN]),
    } as never;
    const guard = new RolesGuard(reflector);

    expect(() =>
      guard.canActivate(createContext({ role: UserRole.CITIZEN })),
    ).toThrow(ForbiddenException);
  });
});
