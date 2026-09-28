import { Module } from '@nestjs/common';
import { LeaksController } from './leaks.controller.js';
import { LeaksService } from './leaks.service.js';

@Module({
  controllers: [LeaksController],
  providers: [LeaksService],
  exports: [LeaksService],
})
export class LeaksModule {}
