import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MAX_IMAGE_BYTES } from '../storage-policy.js';

export class PresignUploadDto {
  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  contentType: string;

  @ApiProperty({ minimum: 1, maximum: MAX_IMAGE_BYTES })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_IMAGE_BYTES)
  contentLength: number;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;
}

export class MultipartPartDto {
  @ApiProperty({ minimum: 1, maximum: 10_000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  partNumber: number;

  @ApiProperty({ minLength: 1, maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  etag: string;
}

export class CompleteUploadDto {
  @ApiProperty({ maxLength: 512 })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(512)
  objectKey: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 512 })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  uploadId?: string;

  @ApiPropertyOptional({ type: [MultipartPartDto] })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(10_000)
  @ValidateNested({ each: true })
  @Type(() => MultipartPartDto)
  parts?: MultipartPartDto[];
}

export class AbortUploadDto {
  @ApiProperty({ maxLength: 512 })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(512)
  objectKey: string;

  @ApiProperty({ minLength: 1, maxLength: 512 })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(512)
  uploadId: string;
}
