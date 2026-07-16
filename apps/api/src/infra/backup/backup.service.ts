import {
  BadRequestException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { mkdir, readdir, rm, stat, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import {
  PrismaService,
  backupTargetFilePath,
  failoverFilePath,
  resolveActiveDb,
  resolveBackupUrl,
} from '../prisma/prisma.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { NotifyService } from '../notify/notify.service';

const INTERVAL_MS = 6 * 3600_000; // backup mỗi 6h
const FIRST_RUN_MS = 3 * 60_000; // lần đầu sau khi boot 3 phút
const KEEP = 7; // giữ 7 bản gần nhất
const STATUS_KEY = 'platform_backup_status';

export interface BackupStatus {
  at: string | null;
  ok: boolean;
  sizeBytes: number;
  replicated: boolean; // đã đẩy sang DB phụ thành công?
  error: string | null;
  durationMs: number;
}

/**
 * 💾 Backup DB nền tảng NGAY TRONG API (không phụ thuộc cron hệ điều hành —
 * cron trên VPS từng bị tắt mà không ai biết):
 * - Mỗi 6h (flag db_backup): pg_dump DB chính → file .sql.gz local (giữ 7 bản)
 *   → đẩy nguyên bản sao sang DB DỰ PHÒNG (DATABASE_URL_BACKUP, vd Neon).
 * - Admin tab "Sao lưu": xem trạng thái, Backup ngay, CHUYỂN sang DB phụ khi
 *   DB chính chết (ghi file db-failover.json + restart API) và chuyển về lại.
 */
@Injectable()
export class BackupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BackupService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly flags: FeatureFlagsService,
    private readonly notify: NotifyService,
  ) {}

  onApplicationBootstrap(): void {
    const t = setTimeout(() => void this.runScheduled(), FIRST_RUN_MS);
    t.unref?.();
    this.timer = setInterval(() => void this.runScheduled(), INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private backupDir(): string {
    const custom = this.config.get<string>('BACKUP_DIR', '');
    if (custom) return custom;
    const dataDir = resolve(process.cwd(), this.config.get<string>('DATA_DIR', '.deploybox-data'));
    return join(dataDir, 'backups');
  }

  private mainUrl(): string {
    return this.config.get<string>('DATABASE_URL', '');
  }

  /** URL DB phụ hiệu lực: admin nhập ở UI (file) → fallback .env. */
  private backupUrl(): string {
    return resolveBackupUrl().url;
  }
  /** Bản cho psql/pg_dump — bỏ "-pooler" (restore DDL nên đi kết nối trực tiếp). */
  private backupUrlDirect(): string {
    return this.backupUrl().replace('-pooler.', '.');
  }

  /** Che mật khẩu + rút gọn để hiện ở UI: host/dbname. */
  private targetDisplay(url: string): string {
    try {
      const u = new URL(url);
      return `${u.hostname}${u.pathname}`;
    } catch {
      return '(URL không đọc được)';
    }
  }

  /** Admin đổi NƠI NHẬN backup (DB phụ) ngay ở UI — test kết nối trước khi lưu.
   *  Lưu vào FILE trên đĩa (không phải DB — failover cần đọc khi DB chính chết).
   *  clear = xoá cấu hình admin, quay về .env. */
  async setTarget(url: string | undefined, clear?: boolean): Promise<{ target: string }> {
    if (resolveActiveDb().usingBackup) {
      throw new BadRequestException('Đang chạy trên DB phụ — chuyển về DB chính trước khi đổi nơi backup');
    }
    if (clear) {
      await rm(backupTargetFilePath(), { force: true }).catch(() => undefined);
      const eff = this.backupUrl();
      return { target: eff ? this.targetDisplay(eff) : '' };
    }
    const v = (url ?? '').trim();
    if (!/^postgres(ql)?:\/\//.test(v)) {
      throw new BadRequestException('URL phải dạng postgresql://user:pass@host/dbname');
    }
    if (v === this.config.get<string>('DATABASE_URL', '')) {
      throw new BadRequestException('DB phụ không được trùng DB chính');
    }
    // Test kết nối thật (SELECT 1, timeout 10s) — sai URL thì báo ngay, không lưu
    await this.sh('psql "$DST" -tAc "select 1" -o /dev/null', {
      DST: v.replace('-pooler.', '.'),
      PGCONNECT_TIMEOUT: '10',
    }).catch((e) => {
      throw new BadRequestException(`Không kết nối được DB phụ: ${(e as Error).message.slice(0, 200)}`);
    });
    await writeFile(
      backupTargetFilePath(),
      JSON.stringify({ url: v, updatedAt: new Date().toISOString() }, null, 2),
    );
    return { target: this.targetDisplay(v) };
  }

  private async runScheduled(): Promise<void> {
    if (!this.flags.isEnabled('db_backup')) return;
    // Đang chạy trên DB phụ → KHÔNG backup (nguồn lúc này là bản sao; tránh ghi đè chéo)
    if (resolveActiveDb().usingBackup) return;
    await this.run().catch((e) => this.logger.warn(`Backup định kỳ lỗi: ${e}`));
  }

  /** Chạy 1 lần backup: dump → local .sql.gz → replicate sang DB phụ. */
  async run(): Promise<BackupStatus> {
    if (this.running) throw new BadRequestException('Backup đang chạy, đợi xong đã');
    this.running = true;
    const started = Date.now();
    const status: BackupStatus = {
      at: new Date().toISOString(),
      ok: false,
      sizeBytes: 0,
      replicated: false,
      error: null,
      durationMs: 0,
    };
    try {
      const dir = this.backupDir();
      await mkdir(dir, { recursive: true });
      const ts = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
      const file = join(dir, `db-platform-${ts}.sql.gz`);

      // 1) Dump DB chính (schema public — chỗ chứa toàn bộ bảng nền tảng)
      await this.sh(
        'set -o pipefail; pg_dump "$SRC" --schema=public --no-owner --no-privileges --clean --if-exists | gzip > "$OUT"',
        { SRC: this.mainUrl(), OUT: file },
      );
      const st = await stat(file);
      if (st.size < 1000) throw new Error(`File backup quá nhỏ (${st.size}B) — nghi hỏng`);
      status.sizeBytes = st.size;

      // 2) Đẩy bản sao sang DB DỰ PHÒNG (nếu cấu hình)
      if (this.backupUrl()) {
        await this.sh(
          'set -o pipefail; gunzip -c "$IN" | psql "$DST" -q -v ON_ERROR_STOP=1 -o /dev/null',
          { IN: file, DST: this.backupUrlDirect() },
        );
        status.replicated = true;
      }

      // 3) Xoay vòng: giữ KEEP bản mới nhất
      const files = (await readdir(dir)).filter((f) => f.startsWith('db-platform-')).sort();
      for (const old of files.slice(0, Math.max(0, files.length - KEEP))) {
        await rm(join(dir, old), { force: true }).catch(() => undefined);
      }

      status.ok = true;
      this.logger.log(
        `💾 Backup OK: ${Math.round(st.size / 1024)}KB${status.replicated ? ' + đã sao sang DB phụ' : ''}`,
      );
    } catch (e) {
      status.error = e instanceof Error ? e.message.slice(0, 500) : String(e);
      this.logger.warn(`Backup THẤT BẠI: ${status.error}`);
      await this.notify
        .broadcast(`🛑 <b>Backup DB nền tảng THẤT BẠI</b>\n<code>${status.error.slice(0, 300)}</code>`)
        .catch(() => undefined);
    } finally {
      status.durationMs = Date.now() - started;
      this.running = false;
      await this.saveStatus(status).catch(() => undefined);
    }
    if (!status.ok) throw new BadRequestException(`Backup thất bại: ${status.error}`);
    return status;
  }

  private async saveStatus(s: BackupStatus): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key: STATUS_KEY },
      update: { value: JSON.stringify(s) },
      create: { key: STATUS_KEY, value: JSON.stringify(s) },
    });
  }

  /** Trạng thái cho Admin UI. */
  async status(): Promise<{
    last: BackupStatus | null;
    files: { name: string; sizeBytes: number }[];
    secondaryConfigured: boolean;
    usingBackupDb: boolean;
    running: boolean;
    target: { display: string; source: 'admin' | 'env' | 'none' };
  }> {
    const row = await this.prisma.setting.findUnique({ where: { key: STATUS_KEY } }).catch(() => null);
    let last: BackupStatus | null = null;
    try {
      last = row?.value ? (JSON.parse(row.value) as BackupStatus) : null;
    } catch {
      /* status hỏng */
    }
    const dir = this.backupDir();
    const files: { name: string; sizeBytes: number }[] = [];
    for (const f of (await readdir(dir).catch(() => [] as string[]))
      .filter((f) => f.startsWith('db-platform-'))
      .sort()
      .reverse()
      .slice(0, KEEP)) {
      const s = await stat(join(dir, f)).catch(() => null);
      if (s) files.push({ name: f, sizeBytes: s.size });
    }
    const t = resolveBackupUrl();
    return {
      last,
      files,
      secondaryConfigured: !!t.url,
      usingBackupDb: resolveActiveDb().usingBackup,
      running: this.running,
      target: { display: t.url ? this.targetDisplay(t.url) : '', source: t.source },
    };
  }

  /**
   * Bật/tắt failover (dùng DB phụ). Ghi file trên ĐĨA rồi caller restart API
   * (pm2 tự kéo dậy) — boot sau đọc file để chọn DB.
   */
  async setFailover(useBackup: boolean): Promise<void> {
    if (useBackup && !this.backupUrl()) {
      throw new BadRequestException('Chưa cấu hình DATABASE_URL_BACKUP — không có DB phụ để chuyển');
    }
    await writeFile(
      failoverFilePath(),
      JSON.stringify({ useBackup, at: new Date().toISOString() }, null, 2),
    );
    this.logger.warn(useBackup ? '⚠️ FAILOVER: chuyển sang DB DỰ PHÒNG — restart…' : 'Về DB chính — restart…');
  }

  /** Chạy lệnh shell (bash để có pipefail), secret truyền qua ENV (không lộ trong ps). */
  private sh(cmd: string, extraEnv: Record<string, string>): Promise<void> {
    return new Promise((res, rej) => {
      const child = spawn('bash', ['-c', cmd], {
        env: { ...process.env, ...extraEnv },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let err = '';
      child.stderr.on('data', (b: Buffer) => (err += b.toString()));
      child.on('error', rej);
      child.on('close', (code) =>
        code === 0 ? res() : rej(new Error(err.trim().slice(-500) || `exit ${code}`)),
      );
    });
  }
}
