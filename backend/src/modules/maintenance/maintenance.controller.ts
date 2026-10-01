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
  PipelineQueryDto,
  ValveQueryDto,
} from '../geography/dto/common.dto.js';
import {
  ChangeValveStateDto,
  CreatePipelineDto,
  CreateValveDto,
  UpdatePipelineDto,
  UpdateValveDto,
  ValveStateChangeResultDto,
} from './dto/maintenance.dto.js';
import {
  PipelineResponseDto,
  ValveResponseDto,
} from './dto/maintenance-response.dto.js';
import { MaintenanceService } from './maintenance.service.js';

@ApiTags('maintenance')
@ApiBearerAuth()
@Controller('maintenance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.FIELD_TECHNICIAN)
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Get('pipelines')
  @ApiOperation({ summary: 'List Pipelines' })
  @ApiResponse({ status: 200 })
  listPipelines(
    @Query() query: PipelineQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.maintenanceService.listPipelines(query, actor);
  }

  @Get('pipelines/:id')
  @ApiOperation({ summary: 'Get a Pipeline' })
  @ApiResponse({ status: 200, type: PipelineResponseDto })
  @ApiResponse({ status: 404, description: 'Pipeline was not found' })
  getPipeline(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.maintenanceService.getPipeline(id, actor);
  }

  @Post('pipelines')
  @ApiOperation({ summary: 'Register a Pipeline' })
  @ApiResponse({ status: 201, type: PipelineResponseDto })
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  createPipeline(
    @Body() dto: CreatePipelineDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.maintenanceService.createPipeline(dto, actor);
  }

  @Patch('pipelines/:id')
  @ApiOperation({ summary: 'Update a Pipeline' })
  @ApiResponse({ status: 200, type: PipelineResponseDto })
  @ApiResponse({ status: 404, description: 'Pipeline was not found' })
  @ApiResponse({
    status: 409,
    description: 'Pipeline was modified by another request',
  })
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  updatePipeline(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePipelineDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.maintenanceService.updatePipeline(id, dto, actor);
  }

  @Get('valves')
  @ApiOperation({ summary: 'List Valves' })
  @ApiResponse({ status: 200 })
  listValves(
    @Query() query: ValveQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.maintenanceService.listValves(query, actor);
  }

  @Get('valves/:id')
  @ApiOperation({ summary: 'Get a Valve' })
  @ApiResponse({ status: 200, type: ValveResponseDto })
  @ApiResponse({ status: 404, description: 'Valve was not found' })
  getValve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.maintenanceService.getValve(id, actor);
  }

  @Post('valves')
  @ApiOperation({ summary: 'Register a Valve' })
  @ApiResponse({ status: 201, type: ValveResponseDto })
  @ApiResponse({ status: 409, description: 'code is already registered' })
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  createValve(
    @Body() dto: CreateValveDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.maintenanceService.createValve(dto, actor);
  }

  @Patch('valves/:id')
  @ApiOperation({ summary: 'Update a Valve' })
  @ApiResponse({ status: 200, type: ValveResponseDto })
  @ApiResponse({ status: 404, description: 'Valve was not found' })
  @ApiResponse({
    status: 409,
    description: 'Valve was modified by another request',
  })
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  updateValve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateValveDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.maintenanceService.updateValve(id, dto, actor);
  }

  @Post('valves/:id/state')
  @ApiOperation({ summary: 'Open or Close a Valve' })
  @ApiResponse({ status: 201, type: ValveStateChangeResultDto })
  @ApiResponse({ status: 404, description: 'Valve was not found' })
  @ApiResponse({
    status: 409,
    description: 'Valve is already in the requested position',
  })
  changeValveState(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ChangeValveStateDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.maintenanceService.changeValveState(id, dto, actor);
  }
}
