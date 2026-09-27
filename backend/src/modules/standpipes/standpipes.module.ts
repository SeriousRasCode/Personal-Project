import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { PublicStandpipesController } from './public-standpipes.controller.js';
import { StandpipesController } from './standpipes.controller.js';
import { StandpipesService } from './standpipes.service.js';

@Module({
  imports: [PassportModule],
  controllers: [StandpipesController, PublicStandpipesController],
  providers: [StandpipesService, JwtAuthGuard, RolesGuard],
  exports: [StandpipesService],
})
export class StandpipesModule {}
