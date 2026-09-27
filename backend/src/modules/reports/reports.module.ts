import { Module } from '@nestjs/common';
import { ConsensusModule } from '../consensus/consensus.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [ConsensusModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
