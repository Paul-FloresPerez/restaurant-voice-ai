export class SessionResponseDto {
  id: string;
  channel: string;
  tableLabel: string | null;
  deviceCode: string | null;
  status: string;
  lastInteractionAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
