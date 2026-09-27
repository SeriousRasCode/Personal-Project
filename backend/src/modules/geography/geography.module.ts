import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { GeographyController } from './geography.controller.js';
import { GeographyService } from './geography.service.js';

@Module({
  imports: [PassportModule],
  controllers: [GeographyController],
  providers: [GeographyService, JwtAuthGuard, RolesGuard],
  exports: [GeographyService],
})
export class GeographyModule {}
