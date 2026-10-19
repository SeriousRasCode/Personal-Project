import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MultipartPartResponseDto {
  @ApiProperty()
  partNumber: number;

  @ApiProperty()
  url: string;

  @ApiProperty()
  expiresInSeconds: number;
}

export class MultipartUploadResponseDto {
  @ApiProperty()
  uploadId: string;

  @ApiProperty()
  objectKey: string;

  @ApiProperty({ type: [MultipartPartResponseDto] })
  parts: MultipartPartResponseDto[];

  @ApiProperty()
  expiresInSeconds: number;
}

export class PresignUploadResponseDto {
  @ApiProperty({
    description: 'Pass this key when attaching the photo to a leak report',
  })
  objectKey: string;

  @ApiProperty()
  uploadUrl: string;

  @ApiProperty({ enum: ['PUT'] })
  method: 'PUT';

  @ApiProperty()
  expiresInSeconds: number;

  @ApiProperty({ additionalProperties: { type: 'string' } })
  headers: Record<string, string>;

  @ApiPropertyOptional({
    type: MultipartUploadResponseDto,
    nullable: true,
    description: 'Set when the photo is large enough to need multipart upload',
  })
  multipart: MultipartUploadResponseDto | null;
}

export class PresignDownloadResponseDto {
  @ApiProperty()
  url: string;

  @ApiProperty()
  expiresInSeconds: number;
}

export class ObjectKeyResponseDto {
  @ApiProperty()
  objectKey: string;
}

export class StorageDeleteResponseDto {
  @ApiProperty()
  deleted: true;
}
