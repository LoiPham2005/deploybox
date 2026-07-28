import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BackupConfigDto, BackupConfigPatch } from '@deploybox/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';

type Field =
  | 'endpoint'
  | 'region'
  | 'bucket'
  | 'pathStyle'
  | 'retention'
  | 'accessKey'
  | 'secretKey';

const SETTING: Record<Field, string> = {
  endpoint: 'backup_s3_endpoint',
  region: 'backup_s3_region',
  bucket: 'backup_s3_bucket',
  pathStyle: 'backup_s3_path_style',
  retention: 'backup_retention_days',
  accessKey: 'backup_s3_access_key',
  secretKey: 'backup_s3_secret_key',
};
const ENV: Record<Field, string> = {
  endpoint: 'BACKUP_S3_ENDPOINT',
  region: 'BACKUP_S3_REGION',
  bucket: 'BACKUP_S3_BUCKET',
  pathStyle: 'BACKUP_S3_PATH_STYLE',
  retention: 'BACKUP_RETENTION_DAYS',
  accessKey: 'BACKUP_S3_ACCESS_KEY',
  secretKey: 'BACKUP_S3_SECRET_KEY',
};
const SECRET: Field[] = ['accessKey', 'secretKey'];

export interface S3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  pathStyle: boolean;
  retentionDays: number;
  accessKey: string;
  secretKey: string;
}

/**
 * Cấu hình nơi lưu backup (S3 tương thích — Vietnix Cloud Storage). Admin sửa ở UI,
 * DB ưu tiên hơn .env, key mã hoá at-rest. (Cùng pattern AiKey/BillingConfig.)
 */
@Injectable()
export class BackupConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  private async resolve(f: Field): Promise<{ value: string; source: 'db' | 'env' | 'none' }> {
    const row = await this.prisma.setting
      .findUnique({ where: { key: SETTING[f] } })
      .catch(() => null);
    if (row?.value) {
      if (SECRET.includes(f)) {
        try {
          return { value: this.crypto.decrypt(row.value).trim(), source: 'db' };
        } catch {
          /* giải mã lỗi → env */
        }
      } else {
        return { value: row.value.trim(), source: 'db' };
      }
    }
    const env = String(this.config.get(ENV[f]) ?? '').trim();
    return { value: env, source: env ? 'env' : 'none' };
  }

  private async val(f: Field): Promise<string> {
    return (await this.resolve(f)).value;
  }

  async getRetentionDays(): Promise<number> {
    const n = Number(await this.val('retention'));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
  }

  async getS3(): Promise<S3Settings> {
    const [endpoint, region, bucket, pathStyle, accessKey, secretKey] = await Promise.all([
      this.val('endpoint'),
      this.val('region'),
      this.val('bucket'),
      this.val('pathStyle'),
      this.val('accessKey'),
      this.val('secretKey'),
    ]);
    return {
      endpoint,
      region: region || 'us-east-1',
      bucket,
      pathStyle: pathStyle === 'true',
      retentionDays: await this.getRetentionDays(),
      accessKey,
      secretKey,
    };
  }

  async isConfigured(): Promise<boolean> {
    const c = await this.getS3();
    return !!(c.endpoint && c.bucket && c.accessKey && c.secretKey);
  }

  async adminView(): Promise<BackupConfigDto> {
    const [endpoint, region, bucket, pathStyle, accessKey, secretKey] = await Promise.all([
      this.resolve('endpoint'),
      this.resolve('region'),
      this.resolve('bucket'),
      this.resolve('pathStyle'),
      this.resolve('accessKey'),
      this.resolve('secretKey'),
    ]);
    return {
      endpoint: endpoint.value,
      region: region.value || 'us-east-1',
      bucket: bucket.value,
      pathStyle: pathStyle.value === 'true',
      retentionDays: await this.getRetentionDays(),
      hasAccessKey: !!accessKey.value,
      hasSecretKey: !!secretKey.value,
      configured: !!(endpoint.value && bucket.value && accessKey.value && secretKey.value),
      source: endpoint.source === 'none' ? 'none' : endpoint.source,
    };
  }

  async save(patch: BackupConfigPatch): Promise<void> {
    const set = async (f: Field, value: string | undefined) => {
      if (value === undefined) return;
      const v = value.trim();
      if (!v) {
        await this.prisma.setting.delete({ where: { key: SETTING[f] } }).catch(() => undefined);
        return;
      }
      const stored = SECRET.includes(f) ? this.crypto.encrypt(v) : v;
      await this.prisma.setting.upsert({
        where: { key: SETTING[f] },
        update: { value: stored },
        create: { key: SETTING[f], value: stored },
      });
    };
    await set('endpoint', patch.endpoint);
    await set('region', patch.region);
    await set('bucket', patch.bucket);
    if (patch.pathStyle !== undefined) await set('pathStyle', patch.pathStyle ? 'true' : 'false');
    if (patch.retentionDays != null) await set('retention', String(patch.retentionDays));
    if (patch.clearAccessKey) await set('accessKey', '');
    else if (patch.accessKey?.trim()) await set('accessKey', patch.accessKey);
    if (patch.clearSecretKey) await set('secretKey', '');
    else if (patch.secretKey?.trim()) await set('secretKey', patch.secretKey);
  }
}
