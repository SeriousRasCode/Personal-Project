import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { UserRole } from '../../generated/prisma/enums.js';
import {
  BatchReadingsDto,
  CreateSensorDto,
  ListAggregatesQueryDto,
  ListReadingsQueryDto,
  ListSensorsQueryDto,
  PressureStatsQueryDto,
  RebuildAggregatesDto,
  RecordReadingDto,
  UpdateSensorDto,
} from './dto/telemetry.dto.js';
import {
  PressureStatsResponseDto,
  RebuildAggregatesResultDto,
  RecordReadingResultDto,
  SensorResponseDto,
} from './dto/telemetry-response.dto.js';
import { TelemetryService } from './telemetry.service.js';

@ApiTags('telemetry')
@ApiBearerAuth()
@Controller('telemetry')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.FIELD_TECHNICIAN)
export class TelemetryController {
  constructor(private readonly telemetryService: TelemetryService) {}

  @Get('sensors')
  @ApiOperation({ summary: 'List Telemetry Sensors' })
  @ApiResponse({ status: 200 })
  listSensors(
    @Query() query: ListSensorsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.telemetryService.listSensors(query, actor);
  }

  @Get('sensors/:id')
  @ApiOperation({ summary: 'Get a Telemetry Sensor' })
  @ApiResponse({ status: 200, type: SensorResponseDto })
  @ApiResponse({ status: 404, description: 'Sensor was not found' })
  getSensor(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.telemetryService.getSensor(id, actor);
  }

  @Post('sensors')
  @ApiOperation({ summary: 'Register a Telemetry Sensor' })
  @ApiResponse({ status: 201, type: SensorResponseDto })
  @ApiResponse({ status: 409, description: 'externalId already registered' })
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  createSensor(
    @Body() dto: CreateSensorDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.telemetryService.createSensor(dto, actor);
  }

  @Patch('sensors/:id')
  @ApiOperation({ summary: 'Update a Telemetry Sensor' })
  @ApiResponse({ status: 200, type: SensorResponseDto })
  @ApiResponse({ status: 404, description: 'Sensor was not found' })
  @ApiResponse({
    status: 409,
    description: 'Sensor was modified by another request',
  })
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  updateSensor(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateSensorDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.telemetryService.updateSensor(id, dto, actor);
  }

  @Get('readings')
  @ApiOperation({ summary: 'List Pressure Readings' })
  @ApiResponse({ status: 200 })
  listReadings(
    @Query() query: ListReadingsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.telemetryService.listReadings(query, actor);
  }

  @Post('readings')
  @ApiOperation({ summary: 'Ingest a Pressure Reading' })
  @ApiResponse({ status: 201, type: RecordReadingResultDto })
  recordReading(
    @Body() dto: RecordReadingDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.telemetryService.recordReading(dto, actor);
  }

  @Post('readings/batch')
  @ApiOperation({ summary: 'Ingest up to 500 Pressure Readings' })
  @ApiResponse({ status: 201, type: RecordReadingResultDto })
  recordReadings(
    @Body() dto: BatchReadingsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.telemetryService.recordReadings(dto, actor);
  }

  @Get('pressure-stats')
  @ApiOperation({ summary: 'Summarise Pressure over a Window' })
  @ApiResponse({ status: 200, type: PressureStatsResponseDto })
  getPressureStats(
    @Query() query: PressureStatsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.telemetryService.getPressureStats(query, actor);
  }

  @Get('aggregates')
  @ApiOperation({ summary: 'List Precomputed Pressure Aggregates' })
  @ApiResponse({ status: 200 })
  listAggregates(
    @Query() query: ListAggregatesQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.telemetryService.listAggregates(query, actor);
  }

  @Post('aggregates/rebuild')
  @HttpCode(200)
  @ApiOperation({ summary: 'Recompute Pressure Aggregates for a Window' })
  @ApiResponse({ status: 200, type: RebuildAggregatesResultDto })
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  rebuildAggregates(
    @Body() dto: RebuildAggregatesDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.telemetryService.rebuildAggregates(dto, actor);
  }
}
