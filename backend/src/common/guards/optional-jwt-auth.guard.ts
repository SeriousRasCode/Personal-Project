import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { isObservable, lastValueFrom } from 'rxjs';

const BaseOptionalJwtAuthGuard = AuthGuard('jwt');

@Injectable()
export class OptionalJwtAuthGuard
  extends BaseOptionalJwtAuthGuard
  implements CanActivate
{
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers?: { authorization?: string | string[] | undefined };
    }>();
    if (!request.headers?.authorization) {
      return true;
    }

    try {
      const result = super.canActivate(context);
      const authenticated = isObservable(result)
        ? await lastValueFrom(result)
        : await Promise.resolve(result);
      return authenticated !== false;
    } catch {
      return true;
    }
  }
}
