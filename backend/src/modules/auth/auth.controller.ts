import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard.js';
import type {
  AuthenticatedUser,
  RequestContext,
} from '../../common/types/authenticated-user.js';
import { AuthService } from './auth.service.js';
import { UserResponseDto } from '../users/dto/user-response.dto.js';
import {
  AuthResponseDto,
  OtpRequestResponseDto,
  OtpVerifyResponseDto,
  RegistrationResponseDto,
} from './dto/auth-response.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { LogoutDto } from './dto/logout.dto.js';
import { OtpRequestDto } from './dto/otp-request.dto.js';
import { OtpVerifyDto } from './dto/otp-verify.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { RegisterDto } from './dto/register.dto.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register a citizen account' })
  @ApiResponse({ status: 201, type: RegistrationResponseDto })
  register(@Body() input: RegisterDto, @Req() request: FastifyRequest) {
    return this.authService.register(input, this.sessionContext(request));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Log in with phone and password' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  login(@Body() input: LoginDto, @Req() request: FastifyRequest) {
    return this.authService.login(input, this.sessionContext(request));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate a refresh token' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  refresh(@Body() input: RefreshDto, @Req() request: FastifyRequest) {
    return this.authService.refresh(input, this.sessionContext(request));
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  @ApiResponse({ status: 200 })
  logout(
    @Body() input: LogoutDto,
    @Req() request: FastifyRequest,
    @CurrentUser() actor: AuthenticatedUser | undefined,
  ) {
    return this.authService.logout(input, actor, this.requestContext(request));
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current user' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.id);
  }

  @Public()
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request a phone OTP' })
  @ApiResponse({ status: 200, type: OtpRequestResponseDto })
  requestOtp(@Body() input: OtpRequestDto, @Req() request: FastifyRequest) {
    return this.authService.requestOtp(
      input,
      undefined,
      this.requestContext(request),
    );
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify a phone OTP' })
  @ApiResponse({ status: 200, type: OtpVerifyResponseDto })
  verifyOtp(@Body() input: OtpVerifyDto, @Req() request: FastifyRequest) {
    return this.authService.verifyOtp(input, this.sessionContext(request));
  }

  private sessionContext(request: FastifyRequest) {
    return this.requestContext(request);
  }

  private requestContext(request: FastifyRequest): RequestContext {
    const userAgentHeader = request.headers['user-agent'];
    return {
      requestId: request.id,
      userAgent:
        typeof userAgentHeader === 'string' ? userAgentHeader : undefined,
      ipAddress: request.ip,
    };
  }
}
