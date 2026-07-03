import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { join, resolve } from 'path';
import type {
  CreateCronDto,
  CronJobDto,
  UpdateCronDto,
} from '@deploybox/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EnvService } from '../env/env.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';
import { cronMatches, isValidCron, parseCron } from './cron.util';

const OUTPUT_CAP = 4096; // giữ tối đa 4KB đuôi output
const JOB_TIMEOUT_MS = 5 * 60_000; // cron job chạy quá 5 phút → kill

@Injectable()
export class CronService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CronService.name);
  private readonly running = new Set<string>(); // job đang chạy (chống chồng)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly env: EnvService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onApplicationBootstrap(): void {
    // Quét mỗi 60s — job khớp phút hiện tại + chưa chạy trong phút này → chạy.
    setInterval(() => void this.tick(), 60_000);
  }

  private async tick(): Promise<void> {
    // Tắt ở Admin → Tính năng hệ thống → scheduler ngừng hẳn (job cũ giữ nguyên)
    if (!this.flags.isEnabled('cron_jobs')) return;
    const now = new Date();
    const jobs = await this.prisma.cronJob
      .findMany({ where: { enabled: true }, include: { project: true } })
      .catch(() => []);
    for (const job of jobs) {
      if (this.running.has(job.id)) continue;
      let spec;
      try {
        spec = parseCron(job.schedule);
      } catch {
        continue; // lịch hỏng → bỏ qua (đã chặn lúc tạo, phòng dữ liệu cũ)
      }
      if (!cronMatches(spec, now)) continue;
      // đã chạy trong cùng phút này rồi → bỏ (tránh chạy 2 lần/phút)
      if (job.lastRunAt && this.sameMinute(job.lastRunAt, now)) continue;
      void this.runJob(job.id).catch((e) =>
        this.logger.warn(`Cron ${job.id} lỗi: ${e instanceof Error ? e.message : e}`),
      );
    }
  }

  private sameMinute(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate() &&
      a.getHours() === b.getHours() &&
      a.getMinutes() === b.getMinutes()
    );
  }

  /** Chạy 1 job (dùng bởi scheduler + nút "Chạy ngay"). */
  async runJob(cronId: string): Promise<CronJobDto> {
    if (this.running.has(cronId)) {
      throw new BadRequestException('Job đang chạy, đợi lần này xong đã.');
    }
    const job = await this.prisma.cronJob.findUnique({
      where: { id: cronId },
      include: { project: true },
    });
    if (!job) throw new NotFoundException('Không tìm thấy cron job');

    this.running.add(cronId);
    try {
      const p = job.project;
      const useDocker = (p as { useDocker?: boolean }).useDocker !== false;
      let result: { ok: boolean; output: string };
      if (useDocker) {
        // Docker mode: chạy trong container đang chạy
        result = await this.exec(
          'docker',
          ['exec', `deploybox-${p.slug}`, 'sh', '-c', job.command],
          process.cwd(),
          process.env,
        );
      } else {
        // Host-run: chạy trong thư mục app với env runtime
        const dataDir = resolve(
          process.cwd(),
          this.config.get<string>('DATA_DIR', '.deploybox-data'),
        );
        const workDir = join(dataDir, 'apps', p.slug, p.rootDir || '.');
        const runtimeEnv = await this.env.resolveForPhase(p.id, 'runtime').catch(() => ({}));
        result = await this.exec('sh', ['-c', job.command], workDir, {
          ...process.env,
          ...runtimeEnv,
          PORT: String(p.internalPort),
          NODE_ENV: 'production',
        });
      }
      const updated = await this.prisma.cronJob.update({
        where: { id: cronId },
        data: {
          lastRunAt: new Date(),
          lastStatus: result.ok ? 'success' : 'failed',
          lastOutput: result.output.slice(-OUTPUT_CAP) || null,
        },
      });
      return this.toDto(updated);
    } finally {
      this.running.delete(cronId);
    }
  }

  private exec(
    cmd: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
  ): Promise<{ ok: boolean; output: string }> {
    return new Promise((res) => {
      let out = '';
      const cap = (b: Buffer) => {
        out += b.toString();
        if (out.length > OUTPUT_CAP * 2) out = out.slice(-OUTPUT_CAP * 2);
      };
      let child;
      try {
        child = spawn(cmd, args, { cwd, env });
      } catch (e) {
        return res({ ok: false, output: e instanceof Error ? e.message : String(e) });
      }
      const timer = setTimeout(() => {
        out += '\n[cron] Quá thời gian, đã kill.';
        child.kill('SIGKILL');
      }, JOB_TIMEOUT_MS);
      child.stdout?.on('data', cap);
      child.stderr?.on('data', cap);
      child.on('error', (e) => {
        clearTimeout(timer);
        res({ ok: false, output: (out + '\n' + e.message).trim() });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        res({ ok: code === 0, output: out.trim() });
      });
    });
  }

  // ─── CRUD (kiểm tra quyền project) ─────────────────────────────────────────

  private async assertAccess(userId: string, projectId: string): Promise<{ teamId: string }> {
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
    return { teamId: project.teamId };
  }

  async list(userId: string, projectId: string): Promise<CronJobDto[]> {
    await this.assertAccess(userId, projectId);
    const jobs = await this.prisma.cronJob.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
    return jobs.map((j) => this.toDto(j));
  }

  async create(userId: string, projectId: string, dto: CreateCronDto): Promise<CronJobDto> {
    this.assertFeatureOn();
    await this.assertAccess(userId, projectId);
    if (!isValidCron(dto.schedule)) {
      throw new BadRequestException('Lịch cron không hợp lệ (5 trường: phút giờ ngày tháng thứ).');
    }
    const job = await this.prisma.cronJob.create({
      data: {
        projectId,
        name: dto.name,
        schedule: dto.schedule.trim(),
        command: dto.command,
        enabled: dto.enabled,
      },
    });
    return this.toDto(job);
  }

  async update(
    userId: string,
    projectId: string,
    cronId: string,
    dto: UpdateCronDto,
  ): Promise<CronJobDto> {
    await this.assertAccess(userId, projectId);
    if (dto.schedule !== undefined && !isValidCron(dto.schedule)) {
      throw new BadRequestException('Lịch cron không hợp lệ.');
    }
    await this.getOwned(projectId, cronId);
    const job = await this.prisma.cronJob.update({
      where: { id: cronId },
      data: {
        name: dto.name,
        schedule: dto.schedule?.trim(),
        command: dto.command,
        enabled: dto.enabled,
      },
    });
    return this.toDto(job);
  }

  async remove(userId: string, projectId: string, cronId: string): Promise<{ ok: true }> {
    await this.assertAccess(userId, projectId);
    await this.getOwned(projectId, cronId);
    await this.prisma.cronJob.delete({ where: { id: cronId } });
    return { ok: true };
  }

  async runNow(userId: string, projectId: string, cronId: string): Promise<CronJobDto> {
    this.assertFeatureOn();
    await this.assertAccess(userId, projectId);
    await this.getOwned(projectId, cronId);
    return this.runJob(cronId);
  }

  private assertFeatureOn(): void {
    if (!this.flags.isEnabled('cron_jobs')) {
      throw new BadRequestException(
        'Tính năng "Cron jobs" đang tắt (Admin → Tính năng hệ thống).',
      );
    }
  }

  private async getOwned(projectId: string, cronId: string) {
    const job = await this.prisma.cronJob.findUnique({ where: { id: cronId } });
    if (!job || job.projectId !== projectId) {
      throw new NotFoundException('Không tìm thấy cron job');
    }
    return job;
  }

  private toDto(j: {
    id: string;
    name: string;
    schedule: string;
    command: string;
    enabled: boolean;
    lastRunAt: Date | null;
    lastStatus: string | null;
    lastOutput: string | null;
    createdAt: Date;
  }): CronJobDto {
    return {
      id: j.id,
      name: j.name,
      schedule: j.schedule,
      command: j.command,
      enabled: j.enabled,
      lastRunAt: j.lastRunAt?.toISOString() ?? null,
      lastStatus: j.lastStatus,
      lastOutput: j.lastOutput,
      createdAt: j.createdAt.toISOString(),
    };
  }
}
