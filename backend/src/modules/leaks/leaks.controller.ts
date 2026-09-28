import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { UserRole } from '../../generated/prisma/enums.js';
import {
  CreateLeakReportDto,
  ListLeakClustersQueryDto,
  ListLeakReportsQueryDto,
  ListPublicLeakClustersQueryDto,
  UpdateLeakStatusDto,
} from './dto/leak.dto.js';
import {
  LeakClusterDetailResponseDto,
  LeakClusterListResponseDto,
  LeakClusterResponseDto,
  LeakReportCreatedResponseDto,
  LeakReportListResponseDto,
  PublicLeakClusterListResponseDto,
} from './dto/leak-response.dto.js';
import { LeaksService } from './leaks.service.js';

const REVIEW_ROLES = [
  UserRole.DISPATCHER,
  UserRole.ADMIN,
  UserRole.FIELD_TECHNICIAN,
] as const;

const TRIAGE_ROLES = [UserRole.DISPATCHER, UserRole.ADMIN] as const;

@ApiTags('leaks')
@Controller('leaks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeaksController {
  constructor(private readonly leaksService: LeaksService) {}

  @Post('reports')
  @ApiOperation({
    summary: 'Report a suspected leak, attaching it to a nearby open cluster',
  })
  @ApiCreatedResponse({ type: LeakReportCreatedResponseDto })
  createLeakReport(
    @Body() dto: CreateLeakReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leaksService.createLeakReport(dto, user);
  }

  @Get('reports')
  @Roles(...REVIEW_ROLES)
  @ApiOperation({ summary: 'List leak reports' })
  @ApiResponse({ status: 200, type: LeakReportListResponseDto })
  listLeakReports(@Query() query: ListLeakReportsQueryDto) {
    return this.leaksService.listLeakReports(query);
  }

  @Get('public/active')
  @Public()
  @ApiOperation({
    summary: 'Get unresolved leak clusters for the public map',
  })
  @ApiOkResponse({ type: PublicLeakClusterListResponseDto })
  listActiveLeakClusters(@Query() query: ListPublicLeakClustersQueryDto) {
    return this.leaksService.listActiveLeakClusters(query);
  }

  @Get('clusters')
  @Roles(...REVIEW_ROLES)
  @ApiOperation({ summary: 'List leak clusters, most severe first' })
  @ApiResponse({ status: 200, type: LeakClusterListResponseDto })
  listLeakClusters(@Query() query: ListLeakClustersQueryDto) {
    return this.leaksService.listLeakClusters(query);
  }

  @Get('clusters/:clusterId')
  @Roles(...REVIEW_ROLES)
  @ApiOperation({ summary: 'Get a leak cluster with its reports' })
  @ApiOkResponse({ type: LeakClusterDetailResponseDto })
  getCluster(
    @Param('clusterId', new ParseUUIDPipe({ version: '4' }))
    clusterId: string,
  ) {
    return this.leaksService.getClusterDetail(clusterId);
  }

  @Patch('clusters/:clusterId/status')
  @Roles(...TRIAGE_ROLES)
  @ApiOperation({
    summary:
      'Move a leak cluster through triage, investigation, and resolution',
  })
  @ApiOkResponse({ type: LeakClusterResponseDto })
  updateClusterStatus(
    @Param('clusterId', new ParseUUIDPipe({ version: '4' }))
    clusterId: string,
    @Body() dto: UpdateLeakStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leaksService.updateClusterStatus(clusterId, dto, user);
  }
}
