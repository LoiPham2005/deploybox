import { Injectable, Logger } from '@nestjs/common';
import { readdir, rm, stat } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { capture } from '../process.util';

type ProjectRef = { id: string; type: string; slug: string };

/** Dọn artifact cũ sau mỗi deploy: giữ N release (STATIC) / N image (BACKEND) mới nhất. */
@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);
  private readonly KEEP = 5;

  constructor(private readonly prisma: PrismaService) {}

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
