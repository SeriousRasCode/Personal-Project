import { Module } from '@nestjs/common';
import { ConsensusController } from './consensus.controller.js';
import { ConsensusService } from './consensus.service.js';

@Module({
  controllers: [ConsensusController],
  providers: [ConsensusService],
  exports: [ConsensusService],
})
export class ConsensusModule {}
