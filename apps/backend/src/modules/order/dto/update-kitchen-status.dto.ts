import { IsIn } from 'class-validator';
import { KitchenStatus, kitchenStatusValues } from '../kitchen-status';

export class UpdateKitchenStatusDto {
  @IsIn(kitchenStatusValues)
  status: KitchenStatus;
}
