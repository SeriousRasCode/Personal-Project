import {
  ConflictException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { OtpPurpose, UserStatus } from '../../generated/prisma/enums.js';
import { invalidCredentialsError } from '../../common/auth/auth-errors.js';
import {
  DUMMY_PASSWORD_HASH,
  PasswordService,
} from '../../common/auth/password.service.js';
import {
  TokenService,
  type AuthTokenPair,
} from '../../common/auth/token.service.js';
import type {
  AuthenticatedUser,
  RequestContext,
  SessionContext,
} from '../../common/types/authenticated-user.js';
import { AuditService } from '../audit/audit.service.js';
import { UsersService, type PublicUser } from '../users/users.service.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RefreshDto } from './dto/refresh.dto.js';
import type { LogoutDto } from './dto/logout.dto.js';
import type { OtpRequestDto } from './dto/otp-request.dto.js';
import type { OtpVerifyDto } from './dto/otp-verify.dto.js';
import {
  type OtpVerificationResult,
  OtpService,
  type OtpRequestResult,
} from './otp.service.js';

export interface AuthResult extends AuthTokenPair {
  user: PublicUser;
}

export interface RegistrationResult {
  verificationRequired: true;
}

export interface OtpLoginResult extends OtpVerificationResult {
  tokens: AuthResult;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly otpService: OtpService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  async register(
    input: RegisterDto,
    context: SessionContext = {},
  ): Promise<RegistrationResult> {
    let user: PublicUser;
    try {
      user = await this.usersService.createCitizen(input);
    } catch (error: unknown) {
      if (error instanceof ConflictException) {
        return { verificationRequired: true };
      }
      throw error;
    }

    await this.recordAudit(
      'identity.auth.registered',
      'User',
      user.id,
      { role: user.role },
      undefined,
      context,
    );
    return { verificationRequired: true };
  }

  async login(
    input: LoginDto,
    context: SessionContext = {},
  ): Promise<AuthResult> {
    const authenticationUser = await this.usersService.findForAuthentication(
      input.phone,
    );
    const passwordMatches = await this.passwordService.verify(
      authenticationUser?.passwordHash ?? DUMMY_PASSWORD_HASH,
      input.password,
    );

    if (
      !authenticationUser ||
      !passwordMatches ||
      authenticationUser.status !== UserStatus.ACTIVE
    ) {
      throw invalidCredentialsError();
    }

    const user = await this.usersService.touchLastLogin(authenticationUser.id);
    const tokens = await this.tokenService.issueTokens(user, context);
    await this.recordAudit(
      'identity.auth.login_succeeded',
      'User',
      user.id,
      { method: 'password' },
      user,
      context,
    );
    return { ...tokens, user };
  }

  async refresh(
    input: RefreshDto,
    context: SessionContext = {},
  ): Promise<AuthResult> {
    const rotated = await this.tokenService.rotateRefreshToken(
      input.refreshToken,
      context,
    );
    const user = await this.usersService.findActiveById(rotated.user.id);
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    await this.recordAudit(
      'identity.auth.refreshed',
      'User',
      user.id,
      {},
      user,
      context,
    );
    return { ...rotated.tokens, user };
  }

  async logout(
    input: LogoutDto,
    actor?: AuthenticatedUser | null,
    context: RequestContext = {},
  ): Promise<{ loggedOut: true }> {
    await this.tokenService.revokeRefreshToken(input.refreshToken, actor?.id);
    if (actor) {
      await this.recordAudit(
        'identity.auth.logged_out',
        'User',
        actor.id,
        {},
        actor,
        context,
      );
    }
    return { loggedOut: true };
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.usersService.findActiveById(userId);
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }

  async requestOtp(
    input: OtpRequestDto,
    actor?: AuthenticatedUser | null,
    context: RequestContext = {},
  ): Promise<OtpRequestResult> {
    const result = await this.otpService.request(input);
    await this.recordAudit(
      'identity.otp.requested',
      'OtpChallenge',
      result.challengeId,
      { purpose: input.purpose ?? OtpPurpose.LOGIN },
      actor,
      context,
    );
    return result;
  }

  async verifyOtp(
    input: OtpVerifyDto,
    context: SessionContext = {},
  ): Promise<OtpVerificationResult | OtpLoginResult> {
    const result = await this.otpService.verify(input);
    if (
      result.purpose !== OtpPurpose.LOGIN &&
      result.purpose !== OtpPurpose.PHONE_VERIFICATION
    ) {
      return result;
    }

    if (!result.user || result.user.status !== UserStatus.ACTIVE) {
      throw invalidCredentialsError();
    }

    const user = await this.usersService.touchLastLogin(result.user.id);
    const tokens = await this.tokenService.issueTokens(user, context);
    await this.recordAudit(
      'identity.auth.login_succeeded',
      'User',
      user.id,
      { method: 'otp' },
      user,
      context,
    );
    return { ...result, user, tokens: { ...tokens, user } };
  }

  private async recordAudit(
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
    actor?: AuthenticatedUser | null,
    context: RequestContext = {},
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
          requestId: context.requestId,
          userAgent: context.userAgent,
          ipAddress: context.ipAddress,
        },
        actor,
      );
    } catch {
      return;
    }
  }
}
