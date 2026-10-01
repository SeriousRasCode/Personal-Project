import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UssdCallbackResponseDto {
  @ApiProperty({ description: 'Session key echoed back to the provider' })
  sessionKey!: string;

  @ApiProperty({ description: 'Caller number in E.164 format' })
  phone!: string;

  @ApiProperty({
    description: 'Menu that produced the message',
    example: 'main',
  })
  step!: string;

  @ApiProperty({ description: 'Message to display to the caller' })
  message!: string;

  @ApiProperty({
    description: 'True when the session was closed by this input',
  })
  ended!: boolean;
}

export class UssdSessionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  sessionKey!: string;

  @ApiProperty()
  phone!: string;

  @ApiProperty({ description: 'Menu the session is currently on' })
  menuPath!: string;

  @ApiProperty()
  expiresAt!: string;

  @ApiProperty()
  active!: boolean;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class UssdSessionListResponseDto {
  @ApiProperty({ type: [UssdSessionResponseDto] })
  items!: UssdSessionResponseDto[];

  @ApiPropertyOptional()
  total!: number;
}
