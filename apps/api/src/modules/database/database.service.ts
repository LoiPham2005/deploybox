import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { CreateDatabaseDto, ManagedDatabaseDto } from '@deploybox/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';
import { capture } from '../../infra/process.util';

const IMAGE: Record<string, string> = {
  POSTGRES: 'postgres:16-alpine',
  REDIS: 'redis:7-alpine',
};
const PORT_BASE = 6000;
const PORT_MAX = 6999;

@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly flags: FeatureFlagsService,
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

  async list(userId: string, projectId: string): Promise<ManagedDatabaseDto[]> {
    await this.assertAccess(userId, projectId);
    const dbs = await this.prisma.managedDatabase.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
    return dbs.map((d) => this.toDto(d));
  }

  async create(
    userId: string,
    projectId: string,
    dto: CreateDatabaseDto,
  ): Promise<ManagedDatabaseDto> {
    // Tắt ở Admin → chặn tạo mới; db đang chạy giữ nguyên, vẫn xoá được để dọn.
    if (!this.flags.isEnabled('managed_databases')) {
      throw new BadRequestException(
        'Tính năng "Database 1-click" đang tắt (Admin → Tính năng hệ thống).',
      );
    }
    const project = await this.assertAccess(userId, projectId);

    // Cổng host trống trong [6000..6999]
    const used = await this.prisma.managedDatabase.findMany({ select: { hostPort: true } });
    const usedSet = new Set(used.map((u) => u.hostPort));
    let port = PORT_BASE;
    while (usedSet.has(port) && port <= PORT_MAX) port++;
    if (port > PORT_MAX) throw new BadRequestException('Hết cổng cấp cho database.');

    const suffix = randomBytes(4).toString('hex');
    const containerName = `deploybox-db-${suffix}`;
    const password = randomBytes(18).toString('base64url');
    const username = 'app';
    const dbName = 'app';
    const engine = dto.engine;
    const image = IMAGE[engine];

    const common = [
      'run', '-d',
      '--name', containerName,
      '--restart', 'unless-stopped',
      '--memory', '256m',
    ];
    const args =
      engine === 'POSTGRES'
        ? [
            ...common,
            '-p', `${port}:5432`,
            '-e', `POSTGRES_USER=${username}`,
            '-e', `POSTGRES_PASSWORD=${password}`,
            '-e', `POSTGRES_DB=${dbName}`,
            '-v', `${containerName}-data:/var/lib/postgresql/data`,
            image,
          ]
        : [
            ...common,
            '-p', `${port}:6379`,
            '-v', `${containerName}-data:/data`,
            image,
            'redis-server', '--requirepass', password,
          ];

    const { code, stderr } = await capture('docker', args);
    if (code !== 0) {
      // dọn container lỡ tạo dở
      await capture('docker', ['rm', '-f', containerName]).catch(() => undefined);
      throw new BadRequestException(
        `Không tạo được database (Docker): ${stderr.trim().slice(0, 300) || 'không rõ'}`,
      );
    }

    // App host-run kết nối qua localhost; app Docker qua host.docker.internal.
    const host = (project as { useDocker?: boolean }).useDocker === false
      ? 'localhost'
      : 'host.docker.internal';
    const envKey = dto.envKey || (engine === 'POSTGRES' ? 'DATABASE_URL' : 'REDIS_URL');
    const conn =
      engine === 'POSTGRES'
        ? `postgresql://${username}:${password}@${host}:${port}/${dbName}`
        : `redis://:${password}@${host}:${port}`;

    // Bơm connection string vào env (mã hoá, dùng cả build + runtime cho migrate)
    await this.prisma.envVar.upsert({
      where: { projectId_key: { projectId, key: envKey } },
      update: { value: this.crypto.encrypt(conn), isSecret: true, target: 'BOTH' },
      create: {
        projectId,
        key: envKey,
        value: this.crypto.encrypt(conn),
        isSecret: true,
        target: 'BOTH',
      },
    });

    const row = await this.prisma.managedDatabase.create({
      data: {
        projectId,
        engine,
        name: dto.name,
        containerName,
        hostPort: port,
        username,
        passwordEnc: this.crypto.encrypt(password),
        dbName,
        envKey,
      },
    });
    this.logger.log(`Tạo database ${engine} "${dto.name}" (${containerName}:${port}) cho project ${projectId}`);
    return { ...this.toDto(row), connectionString: conn };
  }

  async remove(userId: string, projectId: string, dbId: string): Promise<{ ok: true }> {
    await this.assertAccess(userId, projectId);
    const db = await this.prisma.managedDatabase.findUnique({ where: { id: dbId } });
    if (!db || db.projectId !== projectId) {
      throw new NotFoundException('Không tìm thấy database');
    }
    // Xoá container + volume (bỏ qua lỗi nếu đã mất)
    await capture('docker', ['rm', '-f', db.containerName]).catch(() => undefined);
    await capture('docker', ['volume', 'rm', `${db.containerName}-data`]).catch(() => undefined);
    // Gỡ env đã bơm (nếu vẫn là biến này)
    await this.prisma.envVar
      .deleteMany({ where: { projectId, key: db.envKey } })
      .catch(() => undefined);
    await this.prisma.managedDatabase.delete({ where: { id: dbId } });
    return { ok: true };
  }

  private toDto(d: {
    id: string;
    engine: string;
    name: string;
    envKey: string;
    hostPort: number;
    status: string;
    createdAt: Date;
  }): ManagedDatabaseDto {
    return {
      id: d.id,
      engine: d.engine as 'POSTGRES' | 'REDIS',
      name: d.name,
      envKey: d.envKey,
      hostPort: d.hostPort,
      status: d.status,
      createdAt: d.createdAt.toISOString(),
    };
  }
}
