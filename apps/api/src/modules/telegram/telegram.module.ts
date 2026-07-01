import { Module } from '@nestjs/common';
import { TelegramController } from './telegram.controller';
import { TelegramLinkService } from './telegram-link.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule], // để dùng JwtAuthGuard
  controllers: [TelegramController],
  providers: [TelegramLinkService],
  exports: [TelegramLinkService],
})
export class TelegramModule {}
