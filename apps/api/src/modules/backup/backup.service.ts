import { gzipSync } from 'zlib';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { BackupDto, BackupStatsDto } from '@deploybox/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { capture } from '../../infra/process.util';
import { BackupConfigService } from './backup-config.service';
import type { ManagedDatabase, Backup } from '../../generated/prisma';

const SCHEDULE_TEXT = '00:00 (UTC) mỗi đêm';

@Injectable()
export class BackupService {
  private readonly log = new Logger(BackupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: BackupConfigService,
    private readonly crypto: CryptoService,
  ) {}

  private async assertAccess(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Không tìm thấy project');
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: project.teamId, userId } },
    });
    if (!member) throw new ForbiddenException('Bạn không thuộc team này');
    if (member.role !== 'OWNER') {
      const access = await this.prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
      });
      if (!access) throw new ForbiddenException('Bạn không được cấp quyền project này');
    }
    return project;
  }

  private async loadDb(projectId: string, dbId: string): Promise<ManagedDatabase> {
    const db = await this.prisma.managedDatabase.findUnique({ where: { id: dbId } });
    if (!db || db.projectId !== projectId) throw new NotFoundException('Không tìm thấy database');
    return db;
  }

  private async s3() {
    const c = await this.cfg.getS3();
    if (!c.endpoint || !c.bucket || !c.accessKey || !c.secretKey) {
      throw new BadRequestException('Chưa cấu hình nơi lưu backup (Admin → Sao lưu).');
    }
    const client = new S3Client({
      endpoint: c.endpoint,
      region: c.region,
      credentials: { accessKeyId: c.accessKey, secretAccessKey: c.secretKey },
      forcePathStyle: c.pathStyle,
    });
    return { client, bucket: c.bucket };
  }

  /** Dump DB → chuỗi SQL. Chỉ Postgres/MySQL (Redis là cache, không backup). */
  private async dump(db: ManagedDatabase): Promise<string> {
    const pass = this.crypto.decrypt(db.passwordEnc);
    if (db.engine === 'POSTGRES') {
      const { stdout, stderr, code } = await capture('docker', [
        'exec', '-e', `PGPASSWORD=${pass}`, db.containerName,
        'pg_dump', '-U', db.username, db.dbName,
      ]);
      if (code !== 0 || !stdout) throw new Error(`pg_dump lỗi: ${stderr.slice(0, 200)}`);
      return stdout;
    }
    if (db.engine === 'MYSQL') {
      const { stdout, stderr, code } = await capture('docker', [
        'exec', '-e', `MYSQL_PWD=${pass}`, db.containerName,
        'mariadb-dump', '--single-transaction', '--no-tablespaces',
        '-u', db.username, db.dbName,
      ]);
      if (code !== 0 || !stdout) throw new Error(`mariadb-dump lỗi: ${stderr.slice(0, 200)}`);
      return stdout;
    }
    throw new BadRequestException('Chỉ sao lưu được Postgres/MySQL (Redis là cache).');
  }

  private stamp(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
      `_${p(d.getUTCHours())}-${p(d.getUTCMinutes())}-${p(d.getUTCSeconds())}`
    );
  }

  /** Chạy 1 backup (dùng bởi nút + cron). Trả record. Không kiểm quyền (gọi nội bộ). */
  async runBackup(db: ManagedDatabase): Promise<Backup> {
    const { client, bucket } = await this.s3();
    const project = await this.prisma.project.findUnique({ where: { id: db.projectId } });
    const sql = await this.dump(db);
    const gz = gzipSync(Buffer.from(sql, 'utf8'));
    const base = (project?.slug || db.dbName || 'db').replace(/[^a-zA-Z0-9_-]/g, '');
    const filename = `${base}_${this.stamp()}.sql.gz`;
    const s3Key = `deploybox-backups/${db.projectId}/${db.id}/${filename}`;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: gz,
        ContentType: 'application/gzip',
      }),
    );
    const rec = await this.prisma.backup.create({
      data: { databaseId: db.id, filename, s3Key, sizeBytes: gz.length, status: 'done' },
    });
    this.log.log(`✓ Backup ${filename} (${gz.length} bytes) → ${bucket}`);
    return rec;
  }

  async backupNow(userId: string, projectId: string, dbId: string): Promise<BackupDto> {
    await this.assertAccess(userId, projectId);
    const db = await this.loadDb(projectId, dbId);
    const rec = await this.runBackup(db);
    return this.toDto(rec);
  }

  async list(userId: string, projectId: string, dbId: string): Promise<BackupDto[]> {
    await this.assertAccess(userId, projectId);
    await this.loadDb(projectId, dbId);
    const rows = await this.prisma.backup.findMany({
      where: { databaseId: dbId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.toDto(r));
  }

  async stats(userId: string, projectId: string, dbId: string): Promise<BackupStatsDto> {
    await this.assertAccess(userId, projectId);
    const db = await this.loadDb(projectId, dbId);
    const [total, cfg, configured] = await Promise.all([
      this.prisma.backup.count({ where: { databaseId: dbId } }),
      this.cfg.getS3(),
      this.cfg.isConfigured(),
    ]);
    let host = '';
    try {
      host = cfg.endpoint ? new URL(cfg.endpoint).host : '';
    } catch {
      host = cfg.endpoint;
    }
    return {
      autoEnabled: db.backupEnabled,
      scheduleText: SCHEDULE_TEXT,
      retentionDays: cfg.retentionDays,
      total,
      configured,
      destinationText: configured ? `${host} · bucket ${cfg.bucket}` : 'Chưa cấu hình',
    };
  }

  async downloadUrl(userId: string, projectId: string, backupId: string): Promise<{ url: string }> {
    await this.assertAccess(userId, projectId);
    const backup = await this.prisma.backup.findUnique({
      where: { id: backupId },
      include: { database: true },
    });
    if (!backup || backup.database.projectId !== projectId) {
      throw new NotFoundException('Không tìm thấy bản sao lưu');
    }
    const { client, bucket } = await this.s3();
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: backup.s3Key }),
      { expiresIn: 300 },
    );
    return { url };
  }

  async remove(userId: string, projectId: string, backupId: string): Promise<{ ok: true }> {
    await this.assertAccess(userId, projectId);
    const backup = await this.prisma.backup.findUnique({
      where: { id: backupId },
      include: { database: true },
    });
    if (!backup || backup.database.projectId !== projectId) {
      throw new NotFoundException('Không tìm thấy bản sao lưu');
    }
    const { client, bucket } = await this.s3();
    await client
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: backup.s3Key }))
      .catch(() => undefined);
    await this.prisma.backup.delete({ where: { id: backupId } });
    return { ok: true };
  }

  async setAuto(
    userId: string,
    projectId: string,
    dbId: string,
    enabled: boolean,
  ): Promise<{ ok: true }> {
    await this.assertAccess(userId, projectId);
    await this.loadDb(projectId, dbId);
    await this.prisma.managedDatabase.update({
      where: { id: dbId },
      data: { backupEnabled: enabled },
    });
    return { ok: true };
  }

  /** Xoá các bản backup quá hạn giữ (S3 + record). Trả số bản đã xoá. */
  async pruneRetention(): Promise<number> {
    const days = await this.cfg.getRetentionDays();
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const old = await this.prisma.backup.findMany({ where: { createdAt: { lt: cutoff } } });
    if (!old.length) return 0;
    let client: S3Client | null = null;
    let bucket = '';
    try {
      const s = await this.s3();
      client = s.client;
      bucket = s.bucket;
    } catch {
      /* chưa cấu hình S3 → chỉ xoá record */
    }
    for (const b of old) {
      if (client) {
        await client
          .send(new DeleteObjectCommand({ Bucket: bucket, Key: b.s3Key }))
          .catch(() => undefined);
      }
      await this.prisma.backup.delete({ where: { id: b.id } }).catch(() => undefined);
    }
    return old.length;
  }

  private toDto(b: Backup): BackupDto {
    return {
      id: b.id,
      filename: b.filename,
      sizeBytes: b.sizeBytes,
      status: b.status,
      createdAt: b.createdAt.toISOString(),
    };
  }
}
