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
  preDeployCommand?: string | null;
  postDeployCommand?: string | null;
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
  /** PID app đang chạy (null nếu không có pidfile / không đọc được). */
  async getPid(dataDir: string, slug: string): Promise<number | null> {
    const raw = await readFile(this.pidFile(dataDir, slug), 'utf8').catch(() => '');
    const pid = parseInt(raw.trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  }

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
    // Env lúc BUILD: production (Next.js/Vite bắt buộc, chạy ở development sẽ lẫn runtime dev/prod
    // → React null → useContext lỗi). devDeps vẫn được cài nhờ `--include=dev` bên dưới (flag này
    // override NODE_ENV=production, vẫn cài rimraf/nest-cli/tsc...).
    const buildEnv = {
      ...process.env,
      ...(input.env ?? {}),
      PORT: String(input.internalPort),
      NODE_ENV: 'production',
    };
    // Env lúc CHẠY: production.
    const runEnv = buildEnv;

    // 2. Install (nếu có package.json) — `--include=dev` cài cả devDeps dù NODE_ENV=production
    if (await this.exists(join(workDir, 'package.json'))) {
      const install =
        input.installCommand ||
        ((await this.exists(join(workDir, 'package-lock.json')))
          ? 'npm ci --include=dev'
          : 'npm install --include=dev');
      log(`$ ${install}`, 'stdout');
      await this.exec('sh', ['-c', install], workDir, log, buildEnv, input.signal);
    }

    // 3. Build (nếu có lệnh) — production env + devDeps đã cài
    if (input.buildCommand) {
      log(`$ ${input.buildCommand}`, 'stdout');
      await this.exec('sh', ['-c', input.buildCommand], workDir, log, buildEnv, input.signal);
    }

    // 3.5 Pre-deploy hook (vd "npx prisma migrate deploy") — chạy sau build, TRƯỚC khi start.
    if (input.preDeployCommand?.trim()) {
      log(`$ [pre-deploy] ${input.preDeployCommand}`, 'stdout');
      await this.exec('sh', ['-c', input.preDeployCommand], workDir, log, runEnv, input.signal);
    }

    // 4. Dừng process cũ + spawn lệnh chạy
    const result = await this.spawnApp(workDir, runEnv, input, log);

    // 5. Post-deploy hook (vd warmup) — chạy sau khi app đã sống. Lỗi ở đây KHÔNG
    // làm deploy thất bại (app đã chạy rồi), chỉ ghi cảnh báo.
    if (input.postDeployCommand?.trim()) {
      log(`$ [post-deploy] ${input.postDeployCommand}`, 'stdout');
      await this.exec('sh', ['-c', input.postDeployCommand], workDir, log, runEnv, input.signal).catch(
        (e) => log(`Cảnh báo: post-deploy lỗi (bỏ qua): ${e instanceof Error ? e.message : e}`, 'stderr'),
      );
    }
    return result;
  }

  /**
   * Chạy lại app từ bản build SẴN CÓ trên máy (không clone/install/build lại).
   * Dùng cho self-heal: khi DeployBox khởi động lại, process detached cũ có thể đã bị
   * watch-reload kill — hàm này khởi động lại nhanh mà không cần build lại.
   */
  async restart(
    input: Omit<HostBackendInput, 'repoUrl' | 'branch' | 'deploymentId'>,
    log: BuildLogger,
  ): Promise<{ pid: number; port: number }> {
    const appDir = join(input.dataDir, 'apps', input.slug);
    const workDir = join(appDir, input.rootDir || '.');
    if (!(await this.exists(workDir))) {
      throw new Error('Chưa có bản build trên máy — cần Deploy lại');
    }
    const runEnv = {
      ...process.env,
      ...(input.env ?? {}),
      PORT: String(input.internalPort),
      NODE_ENV: 'production',
    };
    return this.spawnApp(workDir, runEnv, input, log);
  }

  /** Stop process cũ rồi spawn lệnh chạy mới (detached) + verify còn sống. */
  private async spawnApp(
    workDir: string,
    runEnv: NodeJS.ProcessEnv,
    input: Pick<HostBackendInput, 'slug' | 'startCommand' | 'internalPort' | 'dataDir'>,
    log: BuildLogger,
  ): Promise<{ pid: number; port: number }> {
    await this.stop(input.dataDir, input.slug, log);

    const startCmd = input.startCommand || 'node dist/main.js';
    log(`$ ${startCmd}  (PORT=${input.internalPort})`, 'stdout');
    const logPath = this.runtimeLog(input.dataDir, input.slug);
    await mkdir(join(input.dataDir, 'runtime-logs'), { recursive: true });
    await mkdir(join(input.dataDir, 'run'), { recursive: true });
    const logFd = openSync(logPath, 'w'); // ghi mới mỗi lần chạy — không lẫn log cũ

    const child = spawn('sh', ['-c', startCmd], {
      cwd: workDir,
      env: runEnv,
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
    child.unref();
    if (!child.pid) throw new Error('Không spawn được process chạy app');
    await writeFile(this.pidFile(input.dataDir, input.slug), String(child.pid));

    // Đợi 2.5s rồi kiểm tra process còn sống
    await new Promise((r) => setTimeout(r, 2500));
    if (!this.alive(child.pid)) {
      const full = await readFile(logPath, 'utf8').catch(() => '');
      // Ưu tiên hiện dòng lỗi thật (Error/Exception/validation) thay vì cuối stack trace
      const errLines = full
        .split('\n')
        .filter((l) => /error|exception|validation|cannot find|econnrefused|listen eaddr/i.test(l))
        .slice(-6)
        .join('\n');
      const detail = errLines || full.slice(-1000);
      throw new Error(`App tắt ngay sau khi chạy. Lỗi:\n${detail}`);
    }
    log(`App đang chạy ở port ${input.internalPort} (PID ${child.pid})`, 'stdout');
    return { pid: child.pid, port: input.internalPort };
  }

  /** Process host-run của slug có đang chạy không (đọc PID file + kiểm tra alive). */
  async isRunning(dataDir: string, slug: string): Promise<boolean> {
    const pid = await readFile(this.pidFile(dataDir, slug), 'utf8')
      .then((s) => parseInt(s.trim(), 10))
      .catch(() => NaN);
    return !!pid && !Number.isNaN(pid) && this.alive(pid);
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
