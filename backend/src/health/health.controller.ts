import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Queue } from 'bullmq';
import { PrismaService } from '../database/prisma.service.js';
import { QUEUES } from '../queues/queue.constants.js';
import { Public } from '../common/decorators/public.decorator.js';

interface DependencyStatus {
  status: 'up' | 'down';
  latencyMs: number;
}

@Public()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prismaService: PrismaService,
    @InjectQueue(QUEUES.NOTIFICATIONS)
    private readonly notificationQueue: Queue,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Process liveness check' })
  @ApiResponse({ status: 200, description: 'The API process is running' })
  live(): { status: 'ok'; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Database and queue readiness check' })
  @ApiResponse({ status: 200, description: 'All dependencies are available' })
  @ApiResponse({ status: 503, description: 'A dependency is unavailable' })
  async ready(): Promise<{
    status: 'ok';
    checks: Record<string, DependencyStatus>;
    timestamp: string;
  }> {
    const [database, redis] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);
    const checks = { database, redis };

    if (Object.values(checks).some((check) => check.status === 'down')) {
      throw new ServiceUnavailableException({
        status: 'error',
        checks,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      status: 'ok',
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<DependencyStatus> {
    const startedAt = performance.now();

    try {
      await this.prismaService.$queryRaw`SELECT 1`;
      return {
        status: 'up',
        latencyMs: Math.round(performance.now() - startedAt),
      };
    } catch {
      return {
        status: 'down',
        latencyMs: Math.round(performance.now() - startedAt),
      };
    }
  }

  private async checkRedis(): Promise<DependencyStatus> {
    const startedAt = performance.now();

    try {
      await this.notificationQueue.getJobCounts();
      return {
        status: 'up',
        latencyMs: Math.round(performance.now() - startedAt),
      };
    } catch {
      return {
        status: 'down',
        latencyMs: Math.round(performance.now() - startedAt),
      };
    }
  }
}
