import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';
import { BackupService } from './backup.service';

const HOUR = 3_600_000;

/**
 * Sao lưu tự động: mỗi giờ kiểm tra; đúng 00:xx UTC thì backup mọi DB đã BẬT
 * (chưa có bản trong 20h qua để tránh trùng khi restart) rồi dọn bản quá hạn giữ.
 */
@Injectable()
export class BackupCronService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(BackupCronService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: FeatureFlagsService,
    private readonly backup: BackupService,
  ) {}

  onApplicationBootstrap() {
    setTimeout(() => void this.tick().catch((e) => this.log.warn(e)), 90_000);
    this.timer = setInterval(() => void this.tick().catch((e) => this.log.warn(e)), HOUR);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    // Tắt ở Admin → ngừng backup tự động.
    if (!this.flags.isEnabled('db_backup')) return;
    if (new Date().getUTCHours() !== 0) return; // chỉ chạy quanh 00:00 UTC

    const dbs = await this.prisma.managedDatabase.findMany({
      where: { backupEnabled: true, engine: { in: ['POSTGRES', 'MYSQL'] } },
    });
    let done = 0;
    for (const db of dbs) {
      const recent = await this.prisma.backup.findFirst({
        where: { databaseId: db.id, createdAt: { gt: new Date(Date.now() - 20 * HOUR) } },
      });
      if (recent) continue;
      await this.backup
        .runBackup(db)
        .then(() => done++)
        .catch((e) => this.log.warn(`Backup tự động lỗi (${db.name}): ${e.message}`));
    }
    const pruned = await this.backup.pruneRetention().catch(() => 0);
    if (done || pruned) this.log.log(`Backup tự động: ${done} bản mới, dọn ${pruned} bản cũ.`);
  }
}
