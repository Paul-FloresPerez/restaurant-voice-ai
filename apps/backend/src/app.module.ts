import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SessionModule } from './modules/session/session.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, SessionModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
