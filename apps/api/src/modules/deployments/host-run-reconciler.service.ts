import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolve } from 'path';
import type { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EnvService } from '../env/env.service';
import { HostBackendBuilder } from '../../infra/builder/host-backend.builder';
import { AiService } from '../../infra/ai/ai.service';
import { NotifyService } from '../../infra/notify/notify.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';
import { opsTip } from '../git/secret-scan.util';

// Quét mỗi 60s; crash quá N lần trong CỬA SỔ 10 phút → dừng hẳn (chống crash-loop)
const SWEEP_MS = 60_000;
const MAX_CRASHES = 3;
const CRASH_WINDOW_MS = 10 * 60_000;
const execFileAsync = promisify(execFile);
// 📈 RAM: giữ tối đa 120 mẫu (~2h), cảnh báo khi tăng ≥1.5x và ≥150MB trong ≥30 phút
const RSS_KEEP = 120;
const RSS_MIN_SAMPLES = 30;
const RSS_COOLDOWN_MS = 6 * 60 * 60_000;

interface WatchedProject {
  id: string;
  slug: string;
  name: string;
  teamId: string;
  type: string;
  useDocker: boolean;
  rootDir: string;
  installCommand: string | null;
  buildCommand: string | null;
  startCommand: string | null;
  outputDir: string | null;
  internalPort: number;
}

/**
 * Watchdog cho app host-run (chạy thẳng node trên máy, không Docker).
 *
 * - Lúc API bootstrap VÀ mỗi 60s: project host-run đang RUNNING mà process chết →
 *   1) đọc đuôi runtime log TRƯỚC (restart sẽ ghi đè log),
 *   2) tự khởi động lại từ bản build sẵn có,
 *   3) AI chẩn đoán nền (best-effort) → lưu Deployment.aiDiagnosis + gửi Telegram.
 * - Chống crash-loop: chết > MAX_CRASHES lần trong 10 phút → dừng hẳn (STOPPED) + báo.
 * - Chống spam AI: cùng "chữ ký lỗi" (đuôi log giống nhau) → không gọi AI lại.
 */
@Injectable()
export class HostRunReconcilerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(HostRunReconcilerService.name);
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;
  /** projectId → mốc thời gian các lần crash gần đây (trong cửa sổ) */
  private crashes = new Map<string, number[]>();
  /** projectId → chữ ký lỗi đã chẩn đoán lần trước (chống gọi AI trùng) */
  private diagnosedSig = new Map<string, string>();
  /** projectId → kích thước runtime log lần quét trước (đếm lỗi MỚI cho cảnh báo sớm) */
  private logSize = new Map<string, number>();
  /** projectId → lần cảnh báo sớm gần nhất (cooldown 30 phút, tránh spam) */
  private warnedAt = new Map<string, number>();
  /** projectId → lịch sử RAM (MB) theo phút — phát hiện tăng đều (memory leak) */
  private rssHistory = new Map<string, { t: number; mb: number }[]>();
  /** projectId → lần cảnh báo RAM gần nhất (cooldown 6h) */
  private rssWarnedAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly env: EnvService,
    private readonly hostBackend: HostBackendBuilder,
    private readonly ai: AiService,
    private readonly notify: NotifyService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onApplicationBootstrap(): void {
    // Chạy nền — không chặn bootstrap; sau đó quét định kỳ
    void this.sweep().catch((e) => this.warn(e));
    this.timer = setInterval(
      () => void this.sweep().catch((e) => this.warn(e)),
      SWEEP_MS,
    );
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private warn(e: unknown): void {
    this.logger.warn(`Watchdog lỗi: ${e instanceof Error ? e.message : e}`);
  }

  private dataDir(): string {
    return resolve(
      process.cwd(),
      this.config.get<string>('DATA_DIR', '.deploybox-data'),
    );
  }

  private async sweep(): Promise<void> {
    if (this.sweeping) return; // không chồng lần quét
    // Tắt ở Admin → Tính năng hệ thống → app crash sẽ KHÔNG tự khởi động lại
    if (!this.flags.isEnabled('app_watchdog')) return;
    this.sweeping = true;
    try {
      const dataDir = this.dataDir();
      const projects: WatchedProject[] = await this.prisma.project.findMany({
        where: {
          useDocker: false,
          type: 'BACKEND',
          deployments: { some: { status: 'RUNNING' } },
        },
        select: {
          id: true, slug: true, name: true, teamId: true, type: true,
          useDocker: true, rootDir: true, installCommand: true,
          buildCommand: true, startCommand: true, outputDir: true,
          internalPort: true,
        },
      });

      for (const project of projects) {
        if (await this.hostBackend.isRunning(dataDir, project.slug)) {
          // App còn sống → soi lỗi mới trong runtime log (cảnh báo sớm trước khi chết)
          await this.checkErrorSpike(project, dataDir).catch(() => undefined);
          // 📈 + lấy mẫu RAM để phát hiện tăng đều (memory leak)
          await this.checkMemoryTrend(project, dataDir).catch(() => undefined);
          continue;
        }
        await this.handleCrash(project, dataDir);
      }
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * ⚡ Cảnh báo sớm: app còn sống nhưng phần log MỚI (từ lần quét trước) có ≥8 dòng lỗi
   * → báo Telegram trước khi app chết hẳn. Cooldown 30 phút/project.
   */
  private async checkErrorSpike(project: WatchedProject, dataDir: string): Promise<void> {
    if (!this.flags.aiEnabled('ai_early_warning')) return;

    const logPath = this.hostBackend.runtimeLog(dataDir, project.slug);
    const buf = await readFile(logPath).catch(() => null);
    if (!buf) return;

    const prev = this.logSize.get(project.id) ?? buf.length; // lần đầu: chỉ ghi mốc
    this.logSize.set(project.id, buf.length);
    if (buf.length <= prev) return; // log bị reset (app restart) hoặc không có gì mới

    // Chỉ xét phần MỚI ghi thêm; nếu quá lớn thì lấy 64KB cuối
    const start = buf.length - prev > 64_000 ? buf.length - 64_000 : prev;
    const fresh = buf.subarray(start).toString('utf8');
    const errLines = fresh
      .split('\n')
      .filter((l) => /\b(error|exception|fatal|unhandled)\b/i.test(l));
    if (errLines.length < 8) return;

    const now = Date.now();
    if (now - (this.warnedAt.get(project.id) ?? 0) < 30 * 60_000) return; // cooldown
    this.warnedAt.set(project.id, now);

    this.logger.warn(
      `Cảnh báo sớm: ${project.slug} có ${errLines.length} dòng lỗi mới trong ~60s`,
    );
    const members = await this.prisma.teamMember.findMany({
      where: { teamId: project.teamId },
      select: { user: { select: { telegramChatId: true } } },
    });
    await this.notify.earlyWarning(
      {
        projectName: project.name,
        errorCount: errLines.length,
        windowSec: 60,
        sample: errLines.slice(0, 3).map((l) => l.slice(0, 160)),
        tip: this.flags.aiEnabled('ai_ops_tips') ? opsTip(fresh) : '',
      },
      members.map((m) => m.user.telegramChatId).filter((x): x is string => !!x),
    );
  }

  /**
   * 📈 Lấy mẫu RAM (RSS) mỗi vòng quét; RAM tăng ≥1.5x VÀ ≥150MB trong ≥30 phút
   * → báo Telegram nghi memory leak. Cooldown 6h/project. (Lịch sử ở RAM — mất khi restart API.)
   */
  private async checkMemoryTrend(project: WatchedProject, dataDir: string): Promise<void> {
    if (!this.flags.aiEnabled('ai_metrics_anomaly')) return;

    const pid = await this.hostBackend.getPid(dataDir, project.slug);
    if (!pid) return;
    const rssKb = await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)])
      .then((r) => parseInt(r.stdout.trim(), 10))
      .catch(() => NaN);
    if (!Number.isFinite(rssKb) || rssKb <= 0) return;

    const mb = Math.round(rssKb / 1024);
    const hist = this.rssHistory.get(project.id) ?? [];
    hist.push({ t: Date.now(), mb });
    while (hist.length > RSS_KEEP) hist.shift();
    this.rssHistory.set(project.id, hist);
    if (hist.length < RSS_MIN_SAMPLES) return;

    const third = Math.floor(hist.length / 3);
    const avg = (arr: { mb: number }[]) => arr.reduce((s, x) => s + x.mb, 0) / arr.length;
    const first = avg(hist.slice(0, third));
    const last = avg(hist.slice(-third));
    if (!(last >= first * 1.5 && last - first >= 150)) return;

    const now = Date.now();
    if (now - (this.rssWarnedAt.get(project.id) ?? 0) < RSS_COOLDOWN_MS) return;
    this.rssWarnedAt.set(project.id, now);

    const minutes = Math.round((hist[hist.length - 1].t - hist[0].t) / 60_000);
    this.logger.warn(
      `RAM bất thường: ${project.slug} ${Math.round(first)}MB → ${Math.round(last)}MB trong ~${minutes} phút`,
    );
    const members = await this.prisma.teamMember.findMany({
      where: { teamId: project.teamId },
      select: { user: { select: { telegramChatId: true } } },
    });
    await this.notify.resourceAnomaly(
      {
        projectName: project.name,
        fromMb: Math.round(first),
        toMb: Math.round(last),
        minutes,
      },
      members.map((m) => m.user.telegramChatId).filter((x): x is string => !!x),
    );
  }

  private async handleCrash(project: WatchedProject, dataDir: string): Promise<void> {
    // 1) Đọc đuôi log TRƯỚC khi restart (restart mở log mode 'w' → mất log cũ)
    const logPath = this.hostBackend.runtimeLog(dataDir, project.slug);
    const fullLog = await readFile(logPath, 'utf8').catch(() => '');
    const crashLog = fullLog.slice(-12_000);

    // 2) Đếm crash trong cửa sổ chống loop
    const now = Date.now();
    const recent = (this.crashes.get(project.id) ?? []).filter(
      (t) => now - t < CRASH_WINDOW_MS,
    );
    recent.push(now);
    this.crashes.set(project.id, recent);
    const crashCount = recent.length;
    const giveUp = crashCount > MAX_CRASHES;

    this.logger.warn(
      `Watchdog: ${project.slug} chết (lần ${crashCount}/${MAX_CRASHES} trong 10ph)` +
        (giveUp ? ' → DỪNG hẳn (crash loop)' : ' → khởi động lại…'),
    );

    // 3) Khởi động lại (nếu chưa vượt ngưỡng)
    let action: 'restarted' | 'stopped' = 'stopped';
    if (!giveUp) {
      try {
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
        action = 'restarted';
        this.logger.log(`Watchdog: ${project.slug} đã chạy lại ✓`);
      } catch (e) {
        this.logger.warn(
          `Watchdog: ${project.slug} không khởi động lại được — ${e instanceof Error ? e.message : e}`,
        );
      }
    }
    if (action === 'stopped') {
      await this.prisma.deployment.updateMany({
        where: { projectId: project.id, status: 'RUNNING' },
        data: {
          status: 'STOPPED',
          errorMessage: giveUp
            ? `App crash ${crashCount} lần trong 10 phút — watchdog đã dừng`
            : 'App crash và không khởi động lại được',
        },
      });
    }

    // 4) AI chẩn đoán (best-effort, chống trùng theo chữ ký lỗi) + Telegram
    void this.diagnoseAndNotify(project, crashLog, action, crashCount).catch((e) =>
      this.warn(e),
    );
  }

  private async diagnoseAndNotify(
    project: WatchedProject,
    crashLog: string,
    action: 'restarted' | 'stopped',
    crashCount: number,
  ): Promise<void> {
    // Tắt flag → không AI, không nhắn (watchdog vẫn restart app như thường)
    if (!this.flags.aiEnabled('ai_watchdog_diagnosis')) return;
    // Chữ ký lỗi = 400 ký tự cuối log (bỏ khoảng trắng) — giống lần trước thì không gọi AI lại
    const sig = crashLog.replace(/\s+/g, ' ').trim().slice(-400);
    let diagnosis = null;
    if (crashLog && sig && this.diagnosedSig.get(project.id) !== sig) {
      diagnosis = await this.ai.tryDiagnose({
        projectId: project.id,
        projectName: project.name,
        projectType: project.type,
        useDocker: project.useDocker,
        installCommand: project.installCommand,
        buildCommand: project.buildCommand,
        startCommand: project.startCommand,
        outputDir: project.outputDir,
        internalPort: project.internalPort,
        rootDir: project.rootDir,
        errorMessage: 'App đang chạy thì bị crash (process chết)',
        log: `[RUNTIME LOG — app crash khi đang chạy]\n${crashLog}`,
      }, 'watchdog');
      if (diagnosis) {
        this.diagnosedSig.set(project.id, sig);
        // Lưu vào bản deploy mới nhất để web hiện card AI
        const latest = await this.prisma.deployment.findFirst({
          where: { projectId: project.id },
          orderBy: { queuedAt: 'desc' },
          select: { id: true },
        });
        if (latest) {
          await this.prisma.deployment.update({
            where: { id: latest.id },
            data: { aiDiagnosis: diagnosis as unknown as Prisma.InputJsonValue },
          });
        }
      }
    }

    const members = await this.prisma.teamMember.findMany({
      where: { teamId: project.teamId },
      select: { user: { select: { telegramChatId: true } } },
    });
    const recipients = members
      .map((m) => m.user.telegramChatId)
      .filter((x): x is string => !!x);
    const tip = this.flags.aiEnabled('ai_ops_tips') ? opsTip(crashLog) : '';
    await this.notify.runtimeCrash(
      { projectName: project.name, action, crashCount, diagnosis, tip },
      recipients,
    );
  }
}
