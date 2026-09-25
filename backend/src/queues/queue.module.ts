import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.getOrThrow<string>('redis.host'),
          port: configService.getOrThrow<number>('redis.port'),
          password: configService.get<string>('redis.password'),
        },
        defaultJobOptions: {
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 5_000,
          },
          removeOnComplete: 1_000,
          removeOnFail: 5_000,
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
