import { Injectable } from '@nestjs/common';
import { spawn } from 'child_process';
import { access, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { openSync } from 'fs';
import { join } from 'path';
import type { BuildLogger } from './host-static.builder';

export interface HostBackendInput {
  deploymentId: string;
  slug: string;
  repoUrl: string;
  repoUrlDisplay?: string;
  branch: string;
  rootDir: string;
  installCommand?: string | null;
  buildCommand?: string | null;
  startCommand?: string | null;
  internalPort: number;
  env?: Record<string, string>;
  dataDir: string;
  signal?: AbortSignal;
}

/**
 * Chạy app BACKEND TRỰC TIẾP trên host bằng Node (KHÔNG Docker):
 * clone → install → build → spawn lệnh chạy (detached) → ghi PID để quản lý.
 * Dùng khi user tắt "Dùng Docker". Đổi lại: không cô lập RAM/CPU như Docker.
 */
@Injectable()
export class HostBackendBuilder {
  private pidFile(dataDir: string, slug: string): string {
    return join(dataDir, 'run', `${slug}.pid`);
  }

  /** Đường dẫn file log runtime (stdout/stderr của process). */
  runtimeLog(dataDir: string, slug: string): string {
    return join(dataDir, 'runtime-logs', `${slug}.log`);
  }

  async run(
    input: HostBackendInput,
    log: BuildLogger,
  ): Promise<{ pid: number; port: number }> {
    const appDir = join(input.dataDir, 'apps', input.slug);
    await rm(appDir, { recursive: true, force: true });
    await mkdir(appDir, { recursive: true });

    // 1. Clone
    log(`$ git clone --depth 1 --branch ${input.branch} ${input.repoUrlDisplay ?? input.repoUrl}`, 'stdout');
    await this.exec('git', ['clone', '--depth', '1', '--branch', input.branch, input.repoUrl, appDir], input.dataDir, log, undefined, input.signal);

    const workDir = join(appDir, input.rootDir || '.');
    const env = { ...process.env, ...(input.env ?? {}), PORT: String(input.internalPort), NODE_ENV: 'production' };

    // 2. Install (nếu có package.json)
    if (await this.exists(join(workDir, 'package.json'))) {
      const install =
        input.installCommand ||
        ((await this.exists(join(workDir, 'package-lock.json'))) ? 'npm ci' : 'npm install');
      log(`$ ${install}`, 'stdout');
      await this.exec('sh', ['-c', install], workDir, log, env, input.signal);
    }

    // 3. Build (nếu có lệnh)
    if (input.buildCommand) {
      log(`$ ${input.buildCommand}`, 'stdout');
      await this.exec('sh', ['-c', input.buildCommand], workDir, log, env, input.signal);
    }

    // 4. Dừng process cũ (nếu có)
    await this.stop(input.dataDir, input.slug, log);

    // 5. Spawn lệnh chạy — detached để sống độc lập với API
    const startCmd = input.startCommand || 'node dist/main.js';
    log(`$ ${startCmd}  (PORT=${input.internalPort})`, 'stdout');
    const logPath = this.runtimeLog(input.dataDir, input.slug);
    await mkdir(join(input.dataDir, 'runtime-logs'), { recursive: true });
    await mkdir(join(input.dataDir, 'run'), { recursive: true });
    const logFd = openSync(logPath, 'a');

    const child = spawn('sh', ['-c', startCmd], {
      cwd: workDir,
      env,
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
    child.unref();
    if (!child.pid) throw new Error('Không spawn được process chạy app');
    await writeFile(this.pidFile(input.dataDir, input.slug), String(child.pid));

    // 6. Đợi 2.5s rồi kiểm tra process còn sống
    await new Promise((r) => setTimeout(r, 2500));
    if (!this.alive(child.pid)) {
      const tail = await readFile(logPath, 'utf8').then((s) => s.slice(-800)).catch(() => '');
      throw new Error(`App tắt ngay sau khi chạy. Log:\n${tail}`);
    }
    log(`App đang chạy ở port ${input.internalPort} (PID ${child.pid})`, 'stdout');
    return { pid: child.pid, port: input.internalPort };
  }

  /** Dừng process host-run của project (kill cả process group). */
  async stop(dataDir: string, slug: string, log?: BuildLogger): Promise<void> {
    const file = this.pidFile(dataDir, slug);
    const pid = await readFile(file, 'utf8').then((s) => parseInt(s.trim(), 10)).catch(() => NaN);
    if (!pid || Number.isNaN(pid)) return;
    try {
      process.kill(-pid, 'SIGTERM'); // kill cả group (detached → process là group leader)
      log?.(`Đã dừng process cũ (PID ${pid})`, 'stdout');
    } catch {
      try { process.kill(pid, 'SIGTERM'); } catch { /* đã chết */ }
    }
    await rm(file, { force: true }).catch(() => {});
  }

  private alive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch { return false; }
  }

  private exists(p: string): Promise<boolean> {
    return access(p).then(() => true, () => false);
  }

  private exec(
    cmd: string,
    args: string[],
    cwd: string,
    log: BuildLogger,
    env?: NodeJS.ProcessEnv,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('Build đã bị hủy (timeout)'));
      const child = spawn(cmd, args, { cwd, env: env ?? process.env });
      const onAbort = () => { child.kill('SIGTERM'); reject(new Error('Build đã bị hủy (timeout)')); };
      signal?.addEventListener('abort', onAbort, { once: true });
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      const onData = (stream: 'stdout' | 'stderr') => (b: Buffer) =>
        b.toString().split('\n').forEach((l) => l.trim() && log(l, stream));
      child.stdout.on('data', onData('stdout'));
      child.stderr.on('data', onData('stderr'));
      child.on('error', (e) => { cleanup(); reject(e); });
      child.on('close', (code) => { cleanup(); code === 0 ? resolve() : reject(new Error(`Lệnh "${cmd}" thoát với mã ${code}`)); });
    });
  }
}
