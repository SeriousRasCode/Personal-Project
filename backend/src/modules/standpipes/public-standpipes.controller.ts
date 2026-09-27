import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { ListStandpipesQueryDto } from './dto/standpipe-query.dto.js';
import {
  PublicStandpipeListResponseDto,
  PublicStandpipeResponseDto,
} from './dto/standpipe-response.dto.js';
import { StandpipesService } from './standpipes.service.js';

@ApiTags('standpipes')
@Controller('public/standpipes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Public()
export class PublicStandpipesController {
  constructor(private readonly standpipesService: StandpipesService) {}

  @Get()
  @ApiOperation({ summary: 'List active public Standpipes' })
  @ApiResponse({ status: 200, type: PublicStandpipeListResponseDto })
  list(@Query() query: ListStandpipesQueryDto) {
    return this.standpipesService.findPublicAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an active public Standpipe' })
  @ApiResponse({ status: 200, type: PublicStandpipeResponseDto })
  get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.standpipesService.findPublicOne(id);
  }
}
