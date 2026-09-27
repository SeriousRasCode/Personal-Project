import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import {
  CreateQueueWaitReportDto,
  CreateTapStatusReportDto,
  ListQueueReportsQueryDto,
  ListTapReportsQueryDto,
} from './dto/report.dto.js';
import {
  QueueWaitReportCreatedResponseDto,
  QueueWaitReportListResponseDto,
  TapStatusReportCreatedResponseDto,
  TapStatusReportListResponseDto,
} from './dto/report-response.dto.js';
import { ReportsService } from './reports.service.js';

@ApiTags('reports')
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post('tap-status')
  @ApiOperation({
    summary: 'Report the observed flow status of a standpipe',
  })
  @ApiCreatedResponse({ type: TapStatusReportCreatedResponseDto })
  createTapStatusReport(
    @Body() dto: CreateTapStatusReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reportsService.createTapStatusReport(dto, user);
  }

  @Get('tap-status')
  @ApiOperation({ summary: 'List tap status reports for a standpipe' })
  @ApiResponse({ status: 200, type: TapStatusReportListResponseDto })
  listTapStatusReports(@Query() query: ListTapReportsQueryDto) {
    return this.reportsService.listTapReports(query);
  }

  @Post('queue-wait')
  @ApiOperation({ summary: 'Report the observed queue wait at a standpipe' })
  @ApiCreatedResponse({ type: QueueWaitReportCreatedResponseDto })
  createQueueWaitReport(
    @Body() dto: CreateQueueWaitReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reportsService.createQueueWaitReport(dto, user);
  }

  @Get('queue-wait')
  @ApiOperation({ summary: 'List queue wait reports for a standpipe' })
  @ApiResponse({ status: 200, type: QueueWaitReportListResponseDto })
  listQueueWaitReports(@Query() query: ListQueueReportsQueryDto) {
    return this.reportsService.listQueueReports(query);
  }
}
