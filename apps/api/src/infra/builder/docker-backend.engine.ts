import { Injectable } from '@nestjs/common';
import { access, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { runStreaming, type LogFn } from '../process.util';
import { DockerService } from '../docker/docker.service';

export interface BackendBuildInput {
  deploymentId: string;
  slug: string;
  repoUrl: string;
  repoUrlDisplay?: string;
  branch: string;
  rootDir: string;
  internalPort: number;
  memoryMb: number;
  cpuLimit: number;
  dataDir: string;
  signal?: AbortSignal;
  /** Repo không có Dockerfile → gọi hook này (AI sinh); trả null = chịu, báo lỗi như cũ. */
  onMissingDockerfile?: (appDir: string) => Promise<string | null>;
}

/**
 * Build & chạy app BACKEND bằng Docker: clone → docker build (cần Dockerfile)
 * → dừng container cũ → docker run (giới hạn RAM/CPU, inject env runtime).
 */
@Injectable()
export class DockerBackendEngine {
  constructor(private readonly docker: DockerService) {}

  async build(
    input: BackendBuildInput,
    runtimeEnv: Record<string, string>,
    log: LogFn,
  ): Promise<{ containerId: string; hostPort: number | null; imageTag: string }> {
    const workDir = join(input.dataDir, 'work', input.deploymentId);
    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true });

    log(
      `$ git clone --depth 1 --branch ${input.branch} ${input.repoUrlDisplay ?? input.repoUrl}`,
      'stdout',
    );
    await runStreaming(
      'git',
      ['clone', '--depth', '1', '--branch', input.branch, input.repoUrl, workDir],
      { cwd: input.dataDir, log, signal: input.signal },
    );

    const appDir = join(workDir, input.rootDir || '.');
    if (!(await this.exists(join(appDir, 'Dockerfile')))) {
      // 🤖 Repo không có Dockerfile → nhờ AI sinh (nếu bật tính năng)
      const generated = input.onMissingDockerfile
        ? await input.onMissingDockerfile(appDir).catch(() => null)
        : null;
      if (generated) {
        await writeFile(join(appDir, 'Dockerfile'), generated, 'utf8');
        log('🤖 Repo không có Dockerfile — AI đã sinh tự động:', 'stdout');
        for (const line of generated.split('\n')) log(`   ${line}`, 'stdout');
      } else {
        throw new Error(
          'App backend cần Dockerfile ở thư mục gốc để build. Bật "AI · Sinh Dockerfile tự động" ở Admin để AI tự sinh.',
        );
      }
    }

    const image = `deploybox-${input.slug}:${input.deploymentId.slice(-8)}`;
    await this.docker.buildImage(image, appDir, log, input.signal);

    const name = `deploybox-${input.slug}`;
    log('Dừng container cũ (nếu có)…', 'stdout');
    await this.docker.remove(name).catch(() => undefined);

    log('Khởi chạy container…', 'stdout');
    const containerId = await this.docker.run({
      name,
      image,
      internalPort: input.internalPort,
      env: runtimeEnv,
      memoryMb: input.memoryMb,
      cpuLimit: input.cpuLimit,
    });

    const hostPort = await this.docker.getHostPort(name, input.internalPort);
    log(`Container "${name}" chạy ở host port ${hostPort ?? '?'}`, 'stdout');
    return { containerId, hostPort, imageTag: image };
  }

  /** Rollback: chạy lại một image đã build sẵn (không clone/build lại). */
  async runImage(
    input: {
      slug: string;
      imageTag: string;
      internalPort: number;
      memoryMb: number;
      cpuLimit: number;
    },
    runtimeEnv: Record<string, string>,
    log: LogFn,
  ): Promise<{ containerId: string; hostPort: number | null }> {
    const name = `deploybox-${input.slug}`;
    log('Dừng container cũ (nếu có)…', 'stdout');
    await this.docker.remove(name).catch(() => undefined);
    log(`Khởi chạy lại image ${input.imageTag}…`, 'stdout');
    const containerId = await this.docker.run({
      name,
      image: input.imageTag,
      internalPort: input.internalPort,
      env: runtimeEnv,
      memoryMb: input.memoryMb,
      cpuLimit: input.cpuLimit,
    });
    const hostPort = await this.docker.getHostPort(name, input.internalPort);
    return { containerId, hostPort };
  }

  private exists(p: string): Promise<boolean> {
    return access(p).then(
      () => true,
      () => false,
    );
  }
}
