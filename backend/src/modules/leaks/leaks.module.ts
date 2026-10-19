import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { LeaksController } from './leaks.controller.js';
import { LeaksService } from './leaks.service.js';

@Module({
  imports: [StorageModule],
  controllers: [LeaksController],
  providers: [LeaksService],
  exports: [LeaksService],
})
export class LeaksModule {}
