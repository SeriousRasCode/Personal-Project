import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import {
  AbortUploadDto,
  CompleteUploadDto,
  PresignUploadDto,
} from './dto/storage.dto.js';
import {
  ObjectKeyResponseDto,
  PresignDownloadResponseDto,
  PresignUploadResponseDto,
  StorageDeleteResponseDto,
} from './dto/storage-response.dto.js';
import { StorageService } from './storage.service.js';

@ApiTags('storage')
@Controller('storage')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('uploads')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Presign a direct photo upload and reserve its object key',
  })
  @ApiOkResponse({ type: PresignUploadResponseDto })
  presignUpload(
    @Body() dto: PresignUploadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.storageService.presignUpload(dto, user);
  }

  @Post('uploads/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Confirm a finished upload, joining the parts of a multipart upload',
  })
  @ApiOkResponse({ type: ObjectKeyResponseDto })
  completeUpload(
    @Body() dto: CompleteUploadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.storageService.completeUpload(dto, user);
  }

  @Post('uploads/abort')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Release the parts of an abandoned multipart upload',
  })
  @ApiOkResponse({ type: StorageDeleteResponseDto })
  abortUpload(
    @Body() dto: AbortUploadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.storageService.abortUpload(dto, user);
  }

  @Get('download/:objectKey')
  @ApiOperation({
    summary: 'Presign a short lived download URL for an owned photo',
  })
  @ApiOkResponse({ type: PresignDownloadResponseDto })
  presignDownload(
    @Param('objectKey') objectKey: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.storageService.presignDownload(objectKey, user);
  }

  @Delete('objects/:objectKey')
  @ApiOperation({ summary: 'Delete a photo object owned by the caller' })
  @ApiOkResponse({ type: StorageDeleteResponseDto })
  deleteObject(
    @Param('objectKey') objectKey: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.storageService.deleteObject(objectKey, user);
  }
}
