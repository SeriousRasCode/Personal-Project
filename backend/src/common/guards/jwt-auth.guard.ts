import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { isObservable, lastValueFrom } from 'rxjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

const BaseJwtAuthGuard = AuthGuard('jwt');

@Injectable()
export class JwtAuthGuard extends BaseJwtAuthGuard {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const result = super.canActivate(context);
    return isObservable(result)
      ? lastValueFrom(result)
      : Promise.resolve(result);
  }
}

export function requireAuthenticatedUser(
  context: ExecutionContext,
): Record<string, unknown> {
  const request = context.switchToHttp().getRequest<{
    user?: Record<string, unknown>;
  }>();
  if (!request.user) {
    throw new UnauthorizedException();
  }
  return request.user;
}
