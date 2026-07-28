import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';
import { BackupConfigService } from './backup-config.service';
import { BackupCronService } from './backup-cron.service';

@Module({
  imports: [AuthModule], // JwtAuthGuard
  controllers: [BackupController],
  providers: [BackupService, BackupConfigService, BackupCronService],
  exports: [BackupConfigService], // AdminModule dùng để cấu hình S3
})
export class BackupModule {}
