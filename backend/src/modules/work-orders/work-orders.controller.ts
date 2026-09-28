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
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { UserRole } from '../../generated/prisma/enums.js';
import {
  CreateWorkOrderDto,
  ListWorkOrderActivitiesQueryDto,
  ListWorkOrdersQueryDto,
  UpdateWorkOrderDto,
  UpdateWorkOrderStatusDto,
} from './dto/work-order.dto.js';
import {
  WorkOrderActivityListResponseDto,
  WorkOrderListResponseDto,
  WorkOrderResponseDto,
} from './dto/work-order-response.dto.js';
import { WorkOrdersService } from './work-orders.service.js';

const SUPERVISORY_ROLES = [UserRole.DISPATCHER, UserRole.ADMIN] as const;

const STAFF_ROLES = [
  UserRole.DISPATCHER,
  UserRole.ADMIN,
  UserRole.FIELD_TECHNICIAN,
  UserRole.STANDPIPE_OPERATOR,
] as const;

@ApiTags('work-orders')
@Controller('work-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WorkOrdersController {
  constructor(private readonly workOrdersService: WorkOrdersService) {}

  @Post()
  @Roles(...SUPERVISORY_ROLES)
  @ApiOperation({
    summary: 'Create a work order, optionally against a leak cluster',
  })
  @ApiCreatedResponse({ type: WorkOrderResponseDto })
  createWorkOrder(
    @Body() dto: CreateWorkOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workOrdersService.createWorkOrder(dto, user);
  }

  @Get()
  @Roles(...STAFF_ROLES)
  @ApiOperation({
    summary:
      'List work orders. Field technicians and operators only see their own.',
  })
  @ApiResponse({ status: 200, type: WorkOrderListResponseDto })
  listWorkOrders(
    @Query() query: ListWorkOrdersQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workOrdersService.listWorkOrders(query, user);
  }

  @Get(':workOrderId')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'Get a single work order' })
  @ApiOkResponse({ type: WorkOrderResponseDto })
  getWorkOrder(
    @Param('workOrderId', new ParseUUIDPipe({ version: '4' }))
    workOrderId: string,
  ) {
    return this.workOrdersService.findWorkOrder(workOrderId);
  }

  @Get(':workOrderId/activities')
  @Roles(...STAFF_ROLES)
  @ApiOperation({ summary: 'List the status history of a work order' })
  @ApiResponse({ status: 200, type: WorkOrderActivityListResponseDto })
  listWorkOrderActivities(
    @Param('workOrderId', new ParseUUIDPipe({ version: '4' }))
    workOrderId: string,
    @Query() query: ListWorkOrderActivitiesQueryDto,
  ) {
    return this.workOrdersService.listActivities(workOrderId, query);
  }

  @Patch(':workOrderId')
  @Roles(...SUPERVISORY_ROLES)
  @ApiOperation({
    summary: 'Update the scheduling and assignment of a work order',
  })
  @ApiOkResponse({ type: WorkOrderResponseDto })
  updateWorkOrder(
    @Param('workOrderId', new ParseUUIDPipe({ version: '4' }))
    workOrderId: string,
    @Body() dto: UpdateWorkOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workOrdersService.updateWorkOrder(workOrderId, dto, user);
  }

  @Patch(':workOrderId/status')
  @Roles(...STAFF_ROLES)
  @ApiOperation({
    summary: 'Move a work order through its lifecycle',
  })
  @ApiOkResponse({ type: WorkOrderResponseDto })
  updateWorkOrderStatus(
    @Param('workOrderId', new ParseUUIDPipe({ version: '4' }))
    workOrderId: string,
    @Body() dto: UpdateWorkOrderStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workOrdersService.updateStatus(workOrderId, dto, user);
  }
}
