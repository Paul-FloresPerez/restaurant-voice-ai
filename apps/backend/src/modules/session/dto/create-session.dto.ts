import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class CreateSessionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  channel?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  tableLabel?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  deviceCode?: string;
}
