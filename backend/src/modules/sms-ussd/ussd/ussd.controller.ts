import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../../common/decorators/public.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { UserRole } from '../../../generated/prisma/enums.js';
import { UssdCallbackDto, UssdSessionQueryDto } from '../dto/ussd.dto.js';
import {
  UssdCallbackResponseDto,
  UssdSessionListResponseDto,
  UssdSessionResponseDto,
} from '../dto/ussd-response.dto.js';
import {
  USSD_SIGNATURE_HEADER,
  USSD_TIMESTAMP_HEADER,
  verifyCallback,
} from './ussd-signature.js';
import { UssdService } from './ussd.service.js';

@ApiTags('ussd')
@Controller('ussd')
export class UssdController {
  constructor(
    private readonly ussdService: UssdService,
    private readonly configService: ConfigService,
  ) {}

  @Post('callback')
  @Public()
  @ApiOperation({
    summary: 'Handle a USSD callback',
    description:
      'Provider facing endpoint. The request must carry an HMAC-SHA256 signature of the timestamp and raw body.',
  })
  @ApiResponse({ status: 201, type: UssdCallbackResponseDto })
  @ApiResponse({ status: 401, description: 'Signature or timestamp rejected' })
  async callback(
    @Req() request: FastifyRequest,
    @Headers(USSD_TIMESTAMP_HEADER) timestamp: string | undefined,
    @Headers(USSD_SIGNATURE_HEADER) signature: string | undefined,
    @Body() dto: UssdCallbackDto,
  ): Promise<UssdCallbackResponseDto> {
    const secret =
      this.configService.get<string>('ussdCallbackSecret') ??
      this.configService.get<string>('USSD_CALLBACK_SECRET');

    if (!secret) {
      throw new UnauthorizedException('USSD callbacks are not configured');
    }

    const raw = this.rawBody(request);
    const valid =
      typeof timestamp === 'string' &&
      typeof signature === 'string' &&
      verifyCallback(secret, { timestamp, signature, body: raw });

    if (!valid) {
      throw new UnauthorizedException('Invalid USSD callback signature');
    }

    return this.ussdService.handleCallback(dto);
  }

  @Get('sessions')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: 'List USSD sessions' })
  @ApiResponse({ status: 200, type: UssdSessionListResponseDto })
  async listSessions(
    @Query() query: UssdSessionQueryDto,
  ): Promise<{ items: UssdSessionResponseDto[]; total: number }> {
    return this.ussdService.listSessions(query);
  }

  private rawBody(request: FastifyRequest): string {
    const raw = (request as { body?: unknown }).body;
    if (typeof raw === 'string') {
      return raw;
    }
    if (raw === undefined || raw === null) {
      return '';
    }
    return JSON.stringify(raw);
  }
}
