import { Injectable } from '@nestjs/common';
import { spawn } from 'child_process';
import { access, cp, mkdir, rm } from 'fs/promises';
import { join } from 'path';

export type BuildLogger = (line: string, stream: 'stdout' | 'stderr') => void;

export interface StaticBuildInput {
  deploymentId: string;
  slug: string;
  repoUrl: string;
  branch: string;
  rootDir: string;
  buildCommand?: string | null;
  outputDir?: string | null;
  env?: Record<string, string>;
  dataDir: string;
}

/**
 * Build web TĨNH ngay trên host (không Docker): clone → (build) → xuất bản
 * thư mục tĩnh vào <dataDir>/sites/<slug>. Phù hợp app nội bộ tin cậy (M1).
 * App backend (chạy container) sẽ dùng một strategy khác chạy bằng Docker.
 */
@Injectable()
export class HostStaticBuilder {
  async build(
    input: StaticBuildInput,
    log: BuildLogger,
  ): Promise<{ publishDir: string; releaseDir: string }> {
    const workDir = join(input.dataDir, 'work', input.deploymentId);
    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true });

    log(
      `$ git clone --depth 1 --branch ${input.branch} ${input.repoUrl}`,
      'stdout',
    );
    await this.run(
      'git',
      ['clone', '--depth', '1', '--branch', input.branch, input.repoUrl, workDir],
      input.dataDir,
      log,
    );

    const appDir = join(workDir, input.rootDir || '.');
    const buildEnv = { ...process.env, ...(input.env ?? {}) };

    if (input.buildCommand) {
      if (await this.exists(join(appDir, 'package.json'))) {
        const installCmd = (await this.exists(join(appDir, 'package-lock.json')))
          ? 'npm ci'
          : 'npm install';
        log(`$ ${installCmd}`, 'stdout');
        await this.run('sh', ['-c', installCmd], appDir, log, buildEnv);
      }
      log(`$ ${input.buildCommand}`, 'stdout');
      await this.run('sh', ['-c', input.buildCommand], appDir, log, buildEnv);
    } else {
      log('Không có lệnh build — phục vụ trực tiếp file tĩnh.', 'stdout');
    }

    const outDir = join(appDir, input.outputDir || '.');
    const releaseDir = join(
      input.dataDir,
      'releases',
      input.slug,
      input.deploymentId,
    );
    await rm(releaseDir, { recursive: true, force: true });
    await mkdir(releaseDir, { recursive: true });
    log(`Xuất bản "${input.outputDir || '.'}" → release`, 'stdout');
    await cp(outDir, releaseDir, {
      recursive: true,
      filter: (src) => {
        const parts = src.split('/');
        return !parts.includes('.git') && !parts.includes('node_modules');
      },
    });

    const liveDir = await this.activate(input.dataDir, input.slug, releaseDir);
    return { publishDir: liveDir, releaseDir };
  }

  /** Kích hoạt một release: copy releases/<slug>/<id> → sites/<slug> (dùng cho cả deploy lẫn rollback). */
  async activate(
    dataDir: string,
    slug: string,
    releaseDir: string,
  ): Promise<string> {
    const liveDir = join(dataDir, 'sites', slug);
    await rm(liveDir, { recursive: true, force: true });
    await mkdir(join(dataDir, 'sites'), { recursive: true });
    await cp(releaseDir, liveDir, { recursive: true });
    return liveDir;
  }

  private exists(p: string): Promise<boolean> {
    return access(p).then(
      () => true,
      () => false,
    );
  }

  private run(
    cmd: string,
    args: string[],
    cwd: string,
    log: BuildLogger,
    env?: NodeJS.ProcessEnv,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { cwd, env: env ?? process.env });
      const onData =
        (stream: 'stdout' | 'stderr') =>
        (buf: Buffer): void => {
          buf
            .toString()
            .split('\n')
            .forEach((line) => {
              if (line.trim()) log(line, stream);
            });
        };
      child.stdout.on('data', onData('stdout'));
      child.stderr.on('data', onData('stderr'));
      child.on('error', (err) => reject(err));
      child.on('close', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Lệnh "${cmd}" thoát với mã ${code}`)),
      );
    });
  }
}
