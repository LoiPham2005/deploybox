import { Module } from '@nestjs/common';
import { TelegramController } from './telegram.controller';
import { TelegramLinkService } from './telegram-link.service';
import { AuthModule } from '../auth/auth.module';
import { DeploymentsModule } from '../deployments/deployments.module';

@Module({
  imports: [AuthModule, DeploymentsModule], // Auth: guard; Deployments: bot thao tác /deploy /stop
  controllers: [TelegramController],
  providers: [TelegramLinkService],
  exports: [TelegramLinkService],
})
export class TelegramModule {}
