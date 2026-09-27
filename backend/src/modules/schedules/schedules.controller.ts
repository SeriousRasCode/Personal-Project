import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UserRole } from '../../generated/prisma/enums.js';
import {
  CreateRotationScheduleDto,
  ListRotationSchedulesDto,
  ScheduleTransitionDto,
  UpdateRotationScheduleDto,
  WindowTransitionDto,
} from './schedules.dto.js';
import { SchedulesService } from './schedules.service.js';
import type { ScheduleRequest } from './schedules.service.js';

@ApiTags('schedules')
@ApiBearerAuth()
@Controller('schedules')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  @Post()
  @Roles(UserRole.DISPATCHER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a draft rotation schedule' })
  @ApiResponse({ status: 201, description: 'Draft schedule created' })
  create(
    @Body() dto: CreateRotationScheduleDto,
    @Req() request: ScheduleRequest,
  ) {
    return this.schedulesService.create(dto, this.actorId(request));
  }

  @Get()
  @Public()
  @ApiOperation({ summary: 'List published and active rotation schedules' })
  @ApiResponse({ status: 200, description: 'Paginated schedules returned' })
  list(@Query() query: ListRotationSchedulesDto) {
    return this.schedulesService.list(query, { publicOnly: true });
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get a rotation schedule and its windows' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Schedule details returned' })
  getById(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.schedulesService.getById(id, { publicOnly: true });
  }

  @Patch(':id')
  @Roles(UserRole.DISPATCHER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a draft rotation schedule' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Draft schedule updated' })
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateRotationScheduleDto,
  ) {
    return this.schedulesService.update(id, dto);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.DISPATCHER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Publish a draft rotation schedule' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Schedule published' })
  publish(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ScheduleTransitionDto,
    @Req() request: ScheduleRequest,
  ) {
    return this.schedulesService.publish(id, dto, this.actorId(request));
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.DISPATCHER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Activate a published rotation schedule' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Schedule activated' })
  activate(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ScheduleTransitionDto,
    @Req() request: ScheduleRequest,
  ) {
    return this.schedulesService.activate(id, dto, this.actorId(request));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.DISPATCHER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Cancel a rotation schedule' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Schedule cancelled' })
  cancel(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ScheduleTransitionDto,
    @Req() request: ScheduleRequest,
  ) {
    return this.schedulesService.cancel(id, dto, this.actorId(request));
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.DISPATCHER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Complete an active rotation schedule' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Schedule completed' })
  complete(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: ScheduleTransitionDto,
    @Req() request: ScheduleRequest,
  ) {
    return this.schedulesService.complete(id, dto, this.actorId(request));
  }

  @Patch(':id/windows/:windowId/open')
  @Roles(UserRole.DISPATCHER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Open a rotation window' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'windowId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Window opened' })
  openWindow(
    @Param('id', new ParseUUIDPipe({ version: '4' })) scheduleId: string,
    @Param('windowId', new ParseUUIDPipe({ version: '4' })) windowId: string,
    @Body() dto: WindowTransitionDto,
    @Req() request: ScheduleRequest,
  ) {
    return this.schedulesService.openWindow(
      scheduleId,
      windowId,
      dto,
      this.actorId(request),
    );
  }

  @Patch(':id/windows/:windowId/close')
  @Roles(UserRole.DISPATCHER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Close a rotation window' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'windowId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Window closed' })
  closeWindow(
    @Param('id', new ParseUUIDPipe({ version: '4' })) scheduleId: string,
    @Param('windowId', new ParseUUIDPipe({ version: '4' })) windowId: string,
    @Body() dto: WindowTransitionDto,
    @Req() request: ScheduleRequest,
  ) {
    return this.schedulesService.closeWindow(
      scheduleId,
      windowId,
      dto,
      this.actorId(request),
    );
  }

  private actorId(request: ScheduleRequest): string {
    const actorId =
      request.user?.id ?? request.user?.userId ?? request.user?.sub;
    if (!actorId) {
      throw new UnauthorizedException('Authenticated user is required');
    }
    return actorId;
  }
}
