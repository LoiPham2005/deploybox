import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readdir, rm, stat, statfs } from 'fs/promises';
import { join, resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { capture } from '../process.util';

type ProjectRef = { id: string; type: string; slug: string };

/** Dọn artifact cũ sau mỗi deploy: giữ N release (STATIC) / N image (BACKEND) mới nhất. */
@Injectable()
export class CleanupService implements OnModuleInit {
  private readonly logger = new Logger(CleanupService.name);
  private readonly KEEP = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onModuleInit() {
    const SIX_HOURS = 6 * 60 * 60_000;
    setInterval(() => { void this.globalPrune(); }, SIX_HOURS);
  }

  private async globalPrune(): Promise<void> {
    this.logger.log('Dọn dẹp định kỳ…');
    await capture('docker', ['image', 'prune', '-f', '--filter', 'until=48h']).catch(() => undefined);
    await capture('docker', ['container', 'prune', '-f']).catch(() => undefined);
    // 🧹 Build cache: image/container prune KHÔNG đụng cache này → nó phình lên GB.
    // Dọn cache > 48h (giữ cache mới để build sau vẫn nhanh). Bật/tắt ở Admin.
    if (this.flags.isEnabled('docker_cache_prune')) {
      const { stdout } = await capture('docker', [
        'builder', 'prune', '-f', '--filter', 'until=48h',
      ]).catch(() => ({ stdout: '' }) as { stdout: string });
      const freed = /Total:\s*(.+)/.exec(stdout)?.[1]?.trim();
      if (freed && freed !== '0B') this.logger.log(`Dọn build cache Docker: giải phóng ${freed}`);
    }
    await this.pruneWorkDirs().catch(() => undefined);
    await this.pruneOrphanLogs().catch(() => undefined);
    this.logger.log('Dọn dẹp xong');
  }

  /** 🧹 Xoá thư mục build tạm (work/) cũ hơn 2 ngày — leftover clone/build không ai dùng. */
  private async pruneWorkDirs(): Promise<void> {
    const dataDir = resolve(process.cwd(), this.config.get<string>('DATA_DIR', '.deploybox-data'));
    const workDir = join(dataDir, 'work');
    const entries = await readdir(workDir).catch(() => [] as string[]);
    const cutoff = Date.now() - 2 * 24 * 60 * 60_000;
    let n = 0;
    for (const e of entries) {
      const s = await stat(join(workDir, e)).catch(() => null);
      if (s && s.mtimeMs < cutoff) {
        await rm(join(workDir, e), { recursive: true, force: true }).catch(() => undefined);
        n++;
      }
    }
    if (n) this.logger.log(`Dọn ${n} thư mục build tạm (work/) cũ`);
  }

  /** Đĩa còn/tổng (GB) + % dùng — cho Admin xem. */
  async diskInfo(): Promise<{ freeGb: number; totalGb: number; usedPct: number }> {
    const s = await statfs('/');
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return {
      freeGb: +(free / 1e9).toFixed(1),
      totalGb: +(total / 1e9).toFixed(1),
      usedPct: total ? Math.round((1 - free / total) * 100) : 0,
    };
  }

  /** Admin bấm "Dọn dung lượng ngay" → chạy dọn toàn bộ + đo dung lượng giải phóng. */
  async cleanNow(): Promise<{ freedMb: number; freeGb: number; totalGb: number }> {
    const before = await this.diskInfo();
    await this.globalPrune();
    const after = await this.diskInfo();
    const freedMb = Math.max(0, Math.round((after.freeGb - before.freeGb) * 1000));
    return { freedMb, freeGb: after.freeGb, totalGb: after.totalGb };
  }

  private async pruneOrphanLogs(): Promise<void> {
    const dataDir = resolve(process.cwd(), this.config.get<string>('DATA_DIR', '.deploybox-data'));
    const logsDir = join(dataDir, 'logs');
    const files = await readdir(logsDir).catch(() => [] as string[]);
    for (const f of files) {
      if (!f.endsWith('.log')) continue;
      const id = f.slice(0, -4);
      const exists = await this.prisma.deployment.findUnique({ where: { id }, select: { id: true } });
      if (!exists) await rm(join(logsDir, f), { force: true }).catch(() => undefined);
    }
  }

  async pruneProject(project: ProjectRef, dataDir: string): Promise<void> {
    if (project.type === 'STATIC') {
      await this.pruneReleases(project, dataDir);
    } else {
      await this.pruneImages(project);
    }
  }

  private async pruneReleases(
    project: ProjectRef,
    dataDir: string,
  ): Promise<void> {
    const dir = join(dataDir, 'releases', project.slug);
    const entries = await readdir(dir).catch(() => [] as string[]);
    if (entries.length <= this.KEEP) return;

    // Không xoá release đang chạy (rollback có thể đang trỏ về bản cũ).
    const active = await this.prisma.deployment.findFirst({
      where: { projectId: project.id, status: 'RUNNING' },
      orderBy: { queuedAt: 'desc' },
    });
    const activeDir = active?.staticPath ?? '';

    const withTime = await Promise.all(
      entries.map(async (e) => ({
        path: join(dir, e),
        m: await stat(join(dir, e))
          .then((s) => s.mtimeMs)
          .catch(() => 0),
      })),
    );
    withTime.sort((a, b) => b.m - a.m); // mới nhất trước
    const toDelete = withTime
      .slice(this.KEEP)
      .filter((x) => x.path !== activeDir);
    for (const x of toDelete) {
      await rm(x.path, { recursive: true, force: true }).catch(() => undefined);
    }
    if (toDelete.length) {
      this.logger.log(`Dọn ${toDelete.length} release cũ của ${project.slug}`);
    }
  }

  private async pruneImages(project: ProjectRef): Promise<void> {
    const repo = `deploybox-${project.slug}`;
    const { stdout, code } = await capture('docker', [
      'images',
      repo,
      '--format',
      '{{.Tag}}',
    ]);
    if (code !== 0) return;
    const tags = stdout.trim().split('\n').filter(Boolean); // docker liệt kê mới nhất trước
    const old = tags.slice(this.KEEP);
    for (const t of old) {
      // image đang dùng bởi container sẽ rmi fail → bỏ qua an toàn
      await capture('docker', ['rmi', `${repo}:${t}`]);
    }
    if (old.length) {
      this.logger.log(`Dọn ${old.length} image cũ của ${repo}`);
    }
  }
}
