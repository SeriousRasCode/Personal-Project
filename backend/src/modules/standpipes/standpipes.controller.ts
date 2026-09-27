import {
  BadRequestException,
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
  CreateStandpipeDto,
  DeactivateStandpipeDto,
  UpdateStandpipeDto,
} from './dto/standpipe.dto.js';
import {
  ListOperatorsQueryDto,
  ListStandpipesQueryDto,
} from './dto/standpipe-query.dto.js';
import {
  StandpipeListResponseDto,
  StandpipeOperatorListResponseDto,
  StandpipeResponseDto,
} from './dto/standpipe-response.dto.js';
import { StandpipesService } from './standpipes.service.js';

@ApiTags('standpipes')
@ApiBearerAuth()
@Controller('standpipes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  UserRole.ADMIN,
  UserRole.DISPATCHER,
  UserRole.FIELD_TECHNICIAN,
  UserRole.STANDPIPE_OPERATOR,
)
export class StandpipesController {
  constructor(private readonly standpipesService: StandpipesService) {}

  @Get()
  @ApiOperation({ summary: 'List Standpipes' })
  @ApiResponse({ status: 200, type: StandpipeListResponseDto })
  list(
    @Query() query: ListStandpipesQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.standpipesService.findAll(query, actor);
  }

  @Get('operators')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: 'List assignable operators' })
  @ApiResponse({ status: 200, type: StandpipeOperatorListResponseDto })
  listOperators(
    @Query() query: ListOperatorsQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.standpipesService.listOperators(query, actor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a Standpipe' })
  @ApiResponse({ status: 200, type: StandpipeResponseDto })
  get(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.standpipesService.findOne(id, actor);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: 'Create a Standpipe' })
  @ApiResponse({ status: 201, type: StandpipeResponseDto })
  create(
    @Body() input: CreateStandpipeDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.standpipesService.create(input, actor);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.DISPATCHER)
  @ApiOperation({ summary: 'Update a Standpipe' })
  @ApiResponse({ status: 200, type: StandpipeResponseDto })
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateStandpipeDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.standpipesService.update(id, input, actor);
  }

  @Patch(':id/deactivate')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Deactivate a Standpipe without deleting history' })
  @ApiResponse({ status: 200, type: StandpipeResponseDto })
  deactivate(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: DeactivateStandpipeDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.standpipesService.deactivate(id, input, actor);
  }

  @Patch(':id/operator')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Assign or unassign a Standpipe operator' })
  @ApiResponse({ status: 200, type: StandpipeResponseDto })
  assignOperator(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateStandpipeDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const expectedUpdatedAt = input.expectedUpdatedAt ?? input.updatedAt;
    if (!expectedUpdatedAt) {
      throw new BadRequestException('expectedUpdatedAt is required');
    }
    if (
      !Object.prototype.hasOwnProperty.call(input, 'operatorProfileId') ||
      input.operatorProfileId === undefined
    ) {
      throw new BadRequestException('operatorProfileId is required');
    }
    return this.standpipesService.assignOperator(
      id,
      input.operatorProfileId,
      expectedUpdatedAt,
      actor,
    );
  }
}
