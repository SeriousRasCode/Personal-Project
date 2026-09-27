import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UserRole } from '../../generated/prisma/enums.js';
import {
  KebeleConsensusListResponseDto,
  QueueSnapshotResponseDto,
  TapConsensusResponseDto,
} from '../reports/dto/report-response.dto.js';
import { ConsensusService } from './consensus.service.js';

@ApiTags('consensus')
@Controller('consensus')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConsensusController {
  constructor(private readonly consensusService: ConsensusService) {}

  @Get('standpipes/:standpipeId/tap-status')
  @Public()
  @ApiOperation({ summary: 'Get the current tap status consensus' })
  @ApiOkResponse({ type: TapConsensusResponseDto })
  async getTapStatus(
    @Param('standpipeId', new ParseUUIDPipe({ version: '4' }))
    standpipeId: string,
  ): Promise<TapConsensusResponseDto | null> {
    await this.consensusService.assertStandpipeExists(standpipeId);
    return this.consensusService.findTapConsensus(standpipeId);
  }

  @Get('standpipes/:standpipeId/queue')
  @Public()
  @ApiOperation({ summary: 'Get the latest queue wait snapshot' })
  @ApiOkResponse({ type: QueueSnapshotResponseDto })
  async getQueue(
    @Param('standpipeId', new ParseUUIDPipe({ version: '4' }))
    standpipeId: string,
  ): Promise<QueueSnapshotResponseDto | null> {
    await this.consensusService.assertStandpipeExists(standpipeId);
    return this.consensusService.findQueueSnapshot(standpipeId);
  }

  @Get('kebeles/:kebeleId/standpipes')
  @Public()
  @ApiOperation({
    summary:
      'Get tap status and queue consensus for every active standpipe in a kebele',
  })
  @ApiResponse({ status: 200, type: KebeleConsensusListResponseDto })
  listKebele(
    @Param('kebeleId', new ParseUUIDPipe({ version: '4' })) kebeleId: string,
  ) {
    return this.consensusService.listKebeleConsensus(kebeleId);
  }

  @Post('standpipes/:standpipeId/recalculate')
  @Roles(UserRole.DISPATCHER, UserRole.ADMIN, UserRole.STANDPIPE_OPERATOR)
  @ApiOperation({
    summary: 'Force a consensus and queue snapshot recalculation',
  })
  @ApiResponse({ status: 201, type: TapConsensusResponseDto })
  async recalculate(
    @Param('standpipeId', new ParseUUIDPipe({ version: '4' }))
    standpipeId: string,
  ) {
    await this.consensusService.assertStandpipeExists(standpipeId);
    await this.consensusService.recalculateQueueSnapshot(standpipeId);
    return this.consensusService.recalculateTapConsensus(standpipeId);
  }
}
