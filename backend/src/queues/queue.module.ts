import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { QUEUES } from './queue.constants.js';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const password = configService.get<string>('redis.password');

        return {
          connection: new Redis({
            host: configService.getOrThrow<string>('redis.host'),
            port: configService.getOrThrow<number>('redis.port'),
            ...(password ? { password } : {}),
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
          }),
          defaultJobOptions: {
            attempts: 5,
            backoff: {
              type: 'exponential',
              delay: 5_000,
            },
            removeOnComplete: 1_000,
            removeOnFail: 5_000,
          },
        };
      },
    }),
    ...Object.values(QUEUES).map((name) => BullModule.registerQueue({ name })),
  ],
  exports: [BullModule],
})
export class QueueModule {}
