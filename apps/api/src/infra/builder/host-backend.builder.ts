import { Injectable, Optional } from '@nestjs/common';
import { spawn } from 'child_process';
import { access, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { openSync, closeSync } from 'fs';
import { join } from 'path';
import type { BuildLogger } from './host-static.builder';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { autofixStartCommand } from './start-autofix.util';

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
  constructor(@Optional() private readonly flags?: FeatureFlagsService) {}

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

  /** Cổng tạm để chạy thử bản mới (blue-green) — lệch xa cổng thật, kẹp trong dải hợp lệ. */
  private altPort(port: number): number {
    const alt = port < 45000 ? port + 20000 : port - 20000;
    return Math.min(64000, Math.max(1024, alt));
  }

  /** Spawn 1 process detached chạy startCmd (ghi log ra logPath). Trả pid. */
  private launch(workDir: string, env: NodeJS.ProcessEnv, startCmd: string, logPath: string): number {
    const logFd = openSync(logPath, 'w'); // ghi mới mỗi lần chạy
    try {
      const child = spawn('sh', ['-c', startCmd], {
        cwd: workDir, env, detached: true, stdio: ['ignore', logFd, logFd],
      });
      child.unref();
      if (!child.pid) throw new Error('Không spawn được process chạy app');
      return child.pid;
    } finally {
      closeSync(logFd); // child đã dup fd riêng — đóng bản của parent, tránh rò
    }
  }

  /** Kill 1 process (cả group). */
  private killTree(pid: number): void {
    try { process.kill(-pid, 'SIGKILL'); }
    catch { try { process.kill(pid, 'SIGKILL'); } catch { /* đã chết */ } }
  }

  /**
   * 🩺 Chạy thử bản mới ở cổng tạm, đợi ~18s:
   * - process chết → 'unhealthy'
   * - HTTP < 500 → 'healthy' (app trả lời)
   * - hết giờ mà còn sống: gặp 5xx → 'unhealthy'; không trả HTTP → 'alive' (chấp nhận — app có thể không phải HTTP)
   */
  private async healthProbe(port: number, pid: number): Promise<'healthy' | 'alive' | 'unhealthy'> {
    let saw5xx = false;
    for (let i = 0; i < 9; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      if (!this.alive(pid)) return 'unhealthy';
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`, {
          signal: AbortSignal.timeout(2500), redirect: 'manual',
        });
        if (res.status < 500) return 'healthy';
        saw5xx = true;
      } catch { /* chưa trả lời — thử lại */ }
    }
    if (!this.alive(pid)) return 'unhealthy';
    return saw5xx ? 'unhealthy' : 'alive';
  }

  /**
   * Deploy bản mới. Mặc định (safe_deploy): chạy thử bản mới ở cổng TẠM trong khi bản cũ
   * vẫn phục vụ; đạt health check mới dừng cũ + chạy bản mới ở cổng thật. Bản mới hỏng →
   * GIỮ bản cũ, app không sập. App cố định cổng (đụng cổng cũ) → tự bỏ qua, deploy thẳng.
   */
  private async spawnApp(
    workDir: string,
    runEnv: NodeJS.ProcessEnv,
    input: Pick<HostBackendInput, 'slug' | 'startCommand' | 'internalPort' | 'dataDir'>,
    log: BuildLogger,
  ): Promise<{ pid: number; port: number }> {
    let startCmd = input.startCommand || 'node dist/main.js';
    // 🔧 Build xuất main.js ra chỗ khác khai báo (vd dist/src/main) → tự dò + sửa
    if (this.flags?.isEnabled('start_autofix') ?? true) {
      const fixed = await autofixStartCommand(startCmd, workDir).catch(() => null);
      if (fixed?.fixed) {
        startCmd = fixed.cmd;
        log(`🔧 Tự sửa lệnh chạy: "${fixed.fixed.from}" không tồn tại → "${fixed.fixed.to}" (file thật sau build)`, 'stdout');
      }
    }
    // 🛡️ Bảo vệ app khỏi OOM-killer: shell tự hạ oom_score_adj rồi fork node →
    // node THỪA KẾ mức bảo vệ. Khi build ngốn RAM làm máy căng, kernel sẽ giết
    // tiến trình BUILD (điểm 0) trước, KHÔNG đụng app (điểm -900). 2>/dev/null để
    // máy không phải Linux / không đủ quyền thì lặng lẽ bỏ qua, app vẫn chạy.
    if (this.flags?.isEnabled('oom_protect_apps') ?? true) {
      startCmd = `echo -900 > /proc/self/oom_score_adj 2>/dev/null; ${startCmd}`;
    }
    await mkdir(join(input.dataDir, 'runtime-logs'), { recursive: true });
    await mkdir(join(input.dataDir, 'run'), { recursive: true });

    // 🩺 Health-gate: có bản cũ đang chạy + cờ bật → thử bản mới ở cổng tạm trước
    const gate = this.flags?.isEnabled('safe_deploy') ?? true;
    if (gate && (await this.isRunning(input.dataDir, input.slug))) {
      const tempPort = this.altPort(input.internalPort);
      const candLog = this.runtimeLog(input.dataDir, input.slug) + '.candidate';
      log(`🩺 Health-gate: chạy thử bản mới ở cổng tạm ${tempPort} (bản cũ vẫn phục vụ)…`, 'stdout');
      const candPid = this.launch(workDir, { ...runEnv, PORT: String(tempPort) }, startCmd, candLog);
      const verdict = await this.healthProbe(tempPort, candPid);
      this.killTree(candPid); // dọn bản thử dù đạt hay không
      await new Promise((r) => setTimeout(r, 500)); // cho cổng tạm giải phóng
      if (verdict === 'unhealthy') {
        const errLog = await readFile(candLog, 'utf8').catch(() => '');
        if (/eaddrinuse|address already in use|listen eacces/i.test(errLog)) {
          // App cố định cổng (không đọc PORT env) → không thử ở cổng tạm được → deploy thẳng
          log('⚠️ App có vẻ cố định cổng (không theo PORT env) → bỏ health-gate, deploy trực tiếp.', 'stderr');
        } else {
          const tail = errLog.split('\n')
            .filter((l) => /error|exception|validation|cannot find|eaddr|listen/i.test(l))
            .slice(-6).join('\n') || errLog.slice(-800);
          throw new Error(`Bản mới KHÔNG lên được (health check thất bại) — GIỮ bản cũ đang chạy, app không sập.\n${tail}`);
        }
      } else {
        log(`✓ Bản mới ${verdict === 'healthy' ? 'trả lời OK' : 'khởi động ổn'} — chuyển sang bản mới…`, 'stdout');
      }
    }

    // Commit: dừng bản cũ → chạy bản mới ở cổng thật
    await this.stop(input.dataDir, input.slug, log);
    log(`$ ${startCmd}  (PORT=${input.internalPort})`, 'stdout');
    const logPath = this.runtimeLog(input.dataDir, input.slug);
    const pid = this.launch(workDir, runEnv, startCmd, logPath);
    await writeFile(this.pidFile(input.dataDir, input.slug), String(pid));

    // Đợi 2.5s rồi kiểm tra process còn sống
    await new Promise((r) => setTimeout(r, 2500));
    if (!this.alive(pid)) {
      const full = await readFile(logPath, 'utf8').catch(() => '');
      const errLines = full.split('\n')
        .filter((l) => /error|exception|validation|cannot find|econnrefused|listen eaddr/i.test(l))
        .slice(-6).join('\n');
      const detail = errLines || full.slice(-1000);
      throw new Error(`App tắt ngay sau khi chạy. Lỗi:\n${detail}`);
    }
    log(`App đang chạy ở port ${input.internalPort} (PID ${pid})`, 'stdout');
    return { pid, port: input.internalPort };
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
