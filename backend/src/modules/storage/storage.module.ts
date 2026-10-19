import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OBJECT_STORAGE } from './object-storage.js';
import { createS3ObjectStorage } from './s3-object-storage.js';
import { StorageController } from './storage.controller.js';
import { StorageService } from './storage.service.js';

export const objectStorageProvider = {
  provide: OBJECT_STORAGE,
  inject: [ConfigService],
  useFactory: (configService: ConfigService) =>
    createS3ObjectStorage(configService),
};

@Module({
  controllers: [StorageController],
  providers: [objectStorageProvider, StorageService],
  exports: [StorageService, OBJECT_STORAGE],
})
export class StorageModule {}
