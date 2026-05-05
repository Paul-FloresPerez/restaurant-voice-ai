import { Injectable } from '@nestjs/common';
import { session_status } from '../../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { SessionResponseDto } from './dto/session-response.dto';

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSessionDto): Promise<SessionResponseDto> {
    const session = await this.prisma.sessions.create({
      data: {
        channel: dto.channel?.trim() || 'voice',
        table_label: dto.tableLabel?.trim() || null,
        device_code: dto.deviceCode?.trim() || null,
        status: session_status.ACTIVE,
      },
    });

    return {
      id: session.id,
      channel: session.channel,
      tableLabel: session.table_label,
      deviceCode: session.device_code,
      status: session.status,
      lastInteractionAt: session.last_interaction_at,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
    };
  }
}
