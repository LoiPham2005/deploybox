import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { PrismaClient } from '../../generated/prisma';

/** File đánh dấu "đang dùng DB dự phòng" — nằm trên ĐĨA (không nằm trong DB,
 *  vì lúc cần failover thì DB chính đã chết). Admin bật/tắt ở tab Sao lưu. */
export function failoverFilePath(): string {
  const dataDir = resolve(process.cwd(), process.env.DATA_DIR || '.deploybox-data');
  return join(dataDir, 'db-failover.json');
}

/** File chứa URL DB dự phòng do ADMIN nhập ở UI (ưu tiên hơn .env). Cũng phải
 *  nằm trên ĐĨA vì lý do như trên — failover cần đọc được khi DB chính chết. */
export function backupTargetFilePath(): string {
  const dataDir = resolve(process.cwd(), process.env.DATA_DIR || '.deploybox-data');
  return join(dataDir, 'db-backup-target.json');
}

/** URL DB dự phòng hiệu lực: admin nhập (file) → fallback .env. */
export function resolveBackupUrl(): { url: string; source: 'admin' | 'env' | 'none' } {
  try {
    const raw = readFileSync(backupTargetFilePath(), 'utf8');
    const state = JSON.parse(raw) as { url?: string };
    if (state.url?.trim()) return { url: state.url.trim(), source: 'admin' };
  } catch {
    /* chưa có file → xuống .env */
  }
  const env = (process.env.DATABASE_URL_BACKUP ?? '').trim();
  return { url: env, source: env ? 'env' : 'none' };
}

/** DB đang dùng thật sự lúc boot: chính, hay phụ (nếu failover bật + có URL phụ). */
export function resolveActiveDb(): { url: string; usingBackup: boolean } {
  const main = process.env.DATABASE_URL ?? '';
  const backup = resolveBackupUrl().url;
  try {
    const raw = readFileSync(failoverFilePath(), 'utf8');
    const state = JSON.parse(raw) as { useBackup?: boolean };
    if (state.useBackup && backup) return { url: backup, usingBackup: true };
  } catch {
    /* chưa có file / hỏng → dùng DB chính */
  }
  return { url: main, usingBackup: false };
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  readonly usingBackupDb: boolean;

  constructor() {
    const active = resolveActiveDb();
    super({ datasources: { db: { url: active.url } } });
    this.usingBackupDb = active.usingBackup;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log(
      this.usingBackupDb
        ? '⚠️ Prisma đã kết nối DB DỰ PHÒNG (failover đang bật — dữ liệu ghi vào DB phụ)'
        : 'Prisma đã kết nối database',
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
