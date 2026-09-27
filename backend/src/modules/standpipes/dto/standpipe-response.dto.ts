import { ApiProperty } from '@nestjs/swagger';
import { GeoPointDto } from '../../../common/dto/geo.dto.js';

export class StandpipeOperatorUserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  displayName: string;
}

export class StandpipeOperatorDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  operatorCode: string;

  @ApiProperty({ nullable: true })
  licenseNumber: string | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ type: StandpipeOperatorUserDto })
  user: StandpipeOperatorUserDto;
}

export class StandpipeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  kebeleId: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  neighborhoodId: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  operatorProfileId: string | null;

  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: GeoPointDto })
  location: GeoPointDto;

  @ApiProperty({ type: Number, nullable: true })
  elevationMeters: number | null;

  @ApiProperty({ type: Number, nullable: true })
  capacityLitersPerMinute: number | null;

  @ApiProperty({ format: 'date', nullable: true })
  installedAt: Date | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt: Date;

  @ApiProperty({ type: StandpipeOperatorDto, nullable: true })
  operator: StandpipeOperatorDto | null;
}

export class StandpipeListResponseDto {
  @ApiProperty({ type: [StandpipeResponseDto] })
  items: StandpipeResponseDto[];

  @ApiProperty({
    type: 'object',
    additionalProperties: false,
    properties: {
      page: { type: Number },
      limit: { type: Number },
      total: { type: Number },
      totalPages: { type: Number },
    },
  })
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class PublicStandpipeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  kebeleId: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  neighborhoodId: string | null;

  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: GeoPointDto })
  location: GeoPointDto;
}

export class PublicStandpipeListResponseDto {
  @ApiProperty({ type: [PublicStandpipeResponseDto] })
  items: PublicStandpipeResponseDto[];

  @ApiProperty({
    type: 'object',
    additionalProperties: false,
    properties: {
      page: { type: Number },
      limit: { type: Number },
      total: { type: Number },
      totalPages: { type: Number },
    },
  })
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export class StandpipeOperatorListResponseDto {
  @ApiProperty({ type: [StandpipeOperatorDto] })
  items: StandpipeOperatorDto[];

  @ApiProperty({
    type: 'object',
    additionalProperties: false,
    properties: {
      page: { type: Number },
      limit: { type: Number },
      total: { type: Number },
      totalPages: { type: Number },
    },
  })
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
