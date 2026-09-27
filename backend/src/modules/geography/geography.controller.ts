import {
  Body,
  Controller,
  Delete,
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
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { UserRole } from '../../generated/prisma/enums.js';
import {
  ActiveSearchQueryDto,
  NeighborhoodQueryDto,
  PipelineQueryDto,
  ValveQueryDto,
} from './dto/common.dto.js';
import {
  CreateKebeleDto,
  PublicKebeleResponseDto,
  UpdateKebeleDto,
  KebeleResponseDto,
} from './dto/kebele.dto.js';
import {
  CreateNeighborhoodDto,
  NeighborhoodResponseDto,
  PublicNeighborhoodResponseDto,
  UpdateNeighborhoodDto,
} from './dto/neighborhood.dto.js';
import {
  CreatePipelineDto,
  PipelineResponseDto,
  PublicPipelineResponseDto,
  UpdatePipelineDto,
} from './dto/pipeline.dto.js';
import {
  CreateValveDto,
  PublicValveResponseDto,
  UpdateValveDto,
  ValveResponseDto,
} from './dto/valve.dto.js';
import { GeographyService } from './geography.service.js';

@ApiTags('geography')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class GeographyController {
  constructor(private readonly geographyService: GeographyService) {}

  @Public()
  @Get('kebeles')
  @ApiOperation({ summary: 'List Kebeles' })
  @ApiResponse({ status: 200, description: 'Paginated Kebeles' })
  listKebeles(@Query() query: ActiveSearchQueryDto) {
    return this.geographyService.findPublicAllKebeles(query);
  }

  @Public()
  @Get('kebeles/:id')
  @ApiOperation({ summary: 'Get a Kebele' })
  @ApiResponse({ status: 200, type: PublicKebeleResponseDto })
  getKebele(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.geographyService.findPublicOneKebele(id);
  }

  @Post('kebeles')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a Kebele' })
  @ApiResponse({ status: 201, type: KebeleResponseDto })
  createKebele(@Body() input: CreateKebeleDto) {
    return this.geographyService.createKebele(input);
  }

  @Patch('kebeles/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a Kebele' })
  @ApiResponse({ status: 200, type: KebeleResponseDto })
  updateKebele(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateKebeleDto,
  ) {
    return this.geographyService.updateKebele(id, input);
  }

  @Delete('kebeles/:id')
  @HttpCode(204)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete a Kebele' })
  @ApiResponse({ status: 204 })
  deleteKebele(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.geographyService.removeKebele(id);
  }

  @Public()
  @Get('neighborhoods')
  @ApiOperation({ summary: 'List Neighborhoods' })
  @ApiResponse({ status: 200, description: 'Paginated Neighborhoods' })
  listNeighborhoods(@Query() query: NeighborhoodQueryDto) {
    return this.geographyService.findPublicAllNeighborhoods(query);
  }

  @Public()
  @Get('neighborhoods/:id')
  @ApiOperation({ summary: 'Get a Neighborhood' })
  @ApiResponse({ status: 200, type: PublicNeighborhoodResponseDto })
  getNeighborhood(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.geographyService.findPublicOneNeighborhood(id);
  }

  @Post('neighborhoods')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a Neighborhood' })
  @ApiResponse({ status: 201, type: NeighborhoodResponseDto })
  createNeighborhood(@Body() input: CreateNeighborhoodDto) {
    return this.geographyService.createNeighborhood(input);
  }

  @Patch('neighborhoods/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a Neighborhood' })
  @ApiResponse({ status: 200, type: NeighborhoodResponseDto })
  updateNeighborhood(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateNeighborhoodDto,
  ) {
    return this.geographyService.updateNeighborhood(id, input);
  }

  @Delete('neighborhoods/:id')
  @HttpCode(204)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete a Neighborhood' })
  @ApiResponse({ status: 204 })
  deleteNeighborhood(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.geographyService.removeNeighborhood(id);
  }

  @Public()
  @Get('pipelines')
  @ApiOperation({ summary: 'List Pipelines' })
  @ApiResponse({ status: 200, description: 'Paginated Pipelines' })
  listPipelines(@Query() query: PipelineQueryDto) {
    return this.geographyService.findPublicAllPipelines(query);
  }

  @Public()
  @Get('pipelines/:id')
  @ApiOperation({ summary: 'Get a Pipeline' })
  @ApiResponse({ status: 200, type: PublicPipelineResponseDto })
  getPipeline(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.geographyService.findPublicOnePipeline(id);
  }

  @Post('pipelines')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a Pipeline' })
  @ApiResponse({ status: 201, type: PipelineResponseDto })
  createPipeline(@Body() input: CreatePipelineDto) {
    return this.geographyService.createPipeline(input);
  }

  @Patch('pipelines/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a Pipeline' })
  @ApiResponse({ status: 200, type: PipelineResponseDto })
  updatePipeline(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdatePipelineDto,
  ) {
    return this.geographyService.updatePipeline(id, input);
  }

  @Delete('pipelines/:id')
  @HttpCode(204)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete a Pipeline' })
  @ApiResponse({ status: 204 })
  deletePipeline(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.geographyService.removePipeline(id);
  }

  @Public()
  @Get('valves')
  @ApiOperation({ summary: 'List Valves' })
  @ApiResponse({ status: 200, description: 'Paginated Valves' })
  listValves(@Query() query: ValveQueryDto) {
    return this.geographyService.findPublicAllValves(query);
  }

  @Public()
  @Get('valves/:id')
  @ApiOperation({ summary: 'Get a Valve' })
  @ApiResponse({ status: 200, type: PublicValveResponseDto })
  getValve(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.geographyService.findPublicOneValve(id);
  }

  @Post('valves')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a Valve' })
  @ApiResponse({ status: 201, type: ValveResponseDto })
  createValve(@Body() input: CreateValveDto) {
    return this.geographyService.createValve(input);
  }

  @Patch('valves/:id')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.FIELD_TECHNICIAN)
  @ApiOperation({ summary: 'Update a Valve' })
  @ApiResponse({ status: 200, type: ValveResponseDto })
  updateValve(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateValveDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.geographyService.updateValve(id, input, actor.id);
  }

  @Delete('valves/:id')
  @HttpCode(204)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete a Valve' })
  @ApiResponse({ status: 204 })
  deleteValve(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.geographyService.removeValve(id);
  }

  @Get('staff/geography/kebeles')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.FIELD_TECHNICIAN)
  @ApiOperation({ summary: 'List Kebeles for staff' })
  listStaffKebeles(@Query() query: ActiveSearchQueryDto) {
    return this.geographyService.findAllKebeles(query);
  }

  @Get('staff/geography/kebeles/:id')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.FIELD_TECHNICIAN)
  @ApiOperation({ summary: 'Get a Kebele for staff' })
  getStaffKebele(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.geographyService.findOneKebele(id);
  }

  @Get('staff/geography/neighborhoods')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.FIELD_TECHNICIAN)
  @ApiOperation({ summary: 'List Neighborhoods for staff' })
  listStaffNeighborhoods(@Query() query: NeighborhoodQueryDto) {
    return this.geographyService.findAllNeighborhoods(query);
  }

  @Get('staff/geography/neighborhoods/:id')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.FIELD_TECHNICIAN)
  @ApiOperation({ summary: 'Get a Neighborhood for staff' })
  getStaffNeighborhood(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.geographyService.findOneNeighborhood(id);
  }

  @Get('staff/geography/pipelines')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.FIELD_TECHNICIAN)
  @ApiOperation({ summary: 'List Pipelines for staff' })
  listStaffPipelines(@Query() query: PipelineQueryDto) {
    return this.geographyService.findAllPipelines(query);
  }

  @Get('staff/geography/pipelines/:id')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.FIELD_TECHNICIAN)
  @ApiOperation({ summary: 'Get a Pipeline for staff' })
  getStaffPipeline(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.geographyService.findOnePipeline(id);
  }

  @Get('staff/geography/valves')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.FIELD_TECHNICIAN)
  @ApiOperation({ summary: 'List Valves for staff' })
  listStaffValves(@Query() query: ValveQueryDto) {
    return this.geographyService.findAllValves(query);
  }

  @Get('staff/geography/valves/:id')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER, UserRole.FIELD_TECHNICIAN)
  @ApiOperation({ summary: 'Get a Valve for staff' })
  getStaffValve(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.geographyService.findOneValve(id);
  }
}
