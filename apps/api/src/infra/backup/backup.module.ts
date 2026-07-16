import { Module } from '@nestjs/common';
import { BackupService } from './backup.service';
import { NotifyService } from '../notify/notify.service';

@Module({
  providers: [BackupService, NotifyService],
  exports: [BackupService],
})
export class BackupModule {}
