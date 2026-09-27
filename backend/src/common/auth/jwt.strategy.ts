import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../modules/users/users.service.js';
import type {
  AccessTokenPayload,
  AuthenticatedUser,
} from '../../common/types/authenticated-user.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    const secret =
      configService.get<string>('jwt.accessSecret') ??
      configService.get<string>('JWT_ACCESS_SECRET');
    if (!secret) {
      throw new Error('JWT access secret is not configured');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    if (
      !payload?.sub ||
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string' ||
      !payload.sid
    ) {
      throw new UnauthorizedException();
    }

    const user = await this.usersService.findActiveById(
      payload.sub,
      payload.sid,
    );
    if (!user) {
      throw new UnauthorizedException();
    }

    return user;
  }
}
