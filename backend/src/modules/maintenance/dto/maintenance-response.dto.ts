import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GeoJsonResponseDto } from '../../geography/dto/common.dto.js';

export class PipelineResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() kebeleId!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) material!: string | null;
  @ApiPropertyOptional({ nullable: true }) diameterMillimeters!: number | null;
  @ApiProperty({ type: GeoJsonResponseDto }) path!: GeoJsonResponseDto;
  @ApiPropertyOptional({ nullable: true }) installedAt!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class ValveResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() kebeleId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiProperty() longitude!: number;
  @ApiProperty() latitude!: number;
  @ApiProperty({ enum: ['OPEN', 'CLOSED'] }) position!: 'OPEN' | 'CLOSED';
  @ApiProperty() isOpen!: boolean;
  @ApiPropertyOptional({ nullable: true }) lastChangedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) lastChangedById!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
