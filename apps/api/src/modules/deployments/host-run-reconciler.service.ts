import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'path';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EnvService } from '../env/env.service';
import { HostBackendBuilder } from '../../infra/builder/host-backend.builder';

/**
 * Self-heal cho app host-run (chạy thẳng node trên máy, không Docker).
 *
 * Process host-run là con của tiến trình DeployBox. Khi DeployBox khởi động lại
 * (vd dev watch-reload, hoặc máy reboot), process con có thể bị kill nhưng deployment
 * vẫn ở trạng thái RUNNING trong DB → status sai + app không phục vụ (502).
 *
 * Khi API bootstrap: với mỗi project host-run đang RUNNING, kiểm tra process còn sống
 * không. Nếu chết → khởi động lại từ bản build sẵn có (không build lại). Khởi động lại
 * thất bại → đánh dấu FAILED để status khớp thực tế.
 */
@Injectable()
export class HostRunReconcilerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(HostRunReconcilerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly env: EnvService,
    private readonly hostBackend: HostBackendBuilder,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Chạy nền — không chặn quá trình bootstrap của API
    void this.reconcile().catch((e) =>
      this.logger.warn(`Self-heal host-run lỗi: ${e instanceof Error ? e.message : e}`),
    );
  }

  private async reconcile(): Promise<void> {
    const dataDir = resolve(
      process.cwd(),
      this.config.get<string>('DATA_DIR', '.deploybox-data'),
    );

    // Các project host-run (useDocker=false) đang có deployment RUNNING
    const projects = await this.prisma.project.findMany({
      where: {
        useDocker: false,
        deployments: { some: { status: 'RUNNING' } },
      },
      select: {
        id: true,
        slug: true,
        rootDir: true,
        startCommand: true,
        internalPort: true,
      },
    });

    for (const project of projects) {
      try {
        if (await this.hostBackend.isRunning(dataDir, project.slug)) continue; // còn sống → bỏ qua

        this.logger.log(`Self-heal: ${project.slug} đã chết → khởi động lại…`);
        const runtimeEnv = await this.env.resolveForPhase(project.id, 'runtime');
        await this.hostBackend.restart(
          {
            slug: project.slug,
            rootDir: project.rootDir,
            startCommand: project.startCommand,
            internalPort: project.internalPort,
            env: runtimeEnv,
            dataDir,
          },
          (line) => this.logger.debug(`[${project.slug}] ${line}`),
        );
        this.logger.log(`Self-heal: ${project.slug} đã chạy lại ✓`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`Self-heal: ${project.slug} không khởi động lại được — ${msg}`);
        // Đánh dấu các bản RUNNING của project thành STOPPED để status khớp thực tế
        await this.prisma.deployment.updateMany({
          where: { projectId: project.id, status: 'RUNNING' },
          data: { status: 'STOPPED', errorMessage: `Self-heal thất bại: ${msg}` },
        });
      }
    }
  }
}
