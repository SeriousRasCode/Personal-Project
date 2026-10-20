import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../database/prisma.service.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { UserRole } from '../../generated/prisma/enums.js';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('events')
  async list(@Query() query: PaginationQueryDto) {
    const [items, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.auditEvent.count(),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }
}
