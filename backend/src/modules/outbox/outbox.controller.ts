import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../database/prisma.service.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { UserRole, OutboxStatus } from '../../generated/prisma/enums.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';

@ApiTags('outbox')
@ApiBearerAuth()
@Controller('outbox')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class OutboxController {
  constructor(private readonly prisma: PrismaService, private readonly dispatcher: OutboxDispatcherService) {}

  @Get('events')
  async list(@Query() query: PaginationQueryDto) {
    const [items, total] = await Promise.all([
      this.prisma.outboxEvent.findMany({ orderBy: { createdAt: 'desc' }, skip: query.skip, take: query.take }),
      this.prisma.outboxEvent.count(),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  @Post('dispatch')
  async dispatch() { return this.dispatcher.dispatchOnce(); }

  @Post('release-stuck')
  async releaseStuck() { return { released: await this.dispatcher.releaseStuckEvents() }; }
}
