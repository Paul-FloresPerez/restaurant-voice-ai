import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class OrderItemModifierDto {
  @IsUUID()
  modifierOptionId: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}
