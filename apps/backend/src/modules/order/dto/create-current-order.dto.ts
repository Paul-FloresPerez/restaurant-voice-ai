import { IsUUID } from 'class-validator';

export class CreateCurrentOrderDto {
  @IsUUID()
  sessionId: string;
}
