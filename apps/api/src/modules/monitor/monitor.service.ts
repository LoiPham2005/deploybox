import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolve } from 'path';
import type { AppIncidentDto, MetricPointDto, OverviewItemDto, UptimeStatusDto } from '@deploybox/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { DockerService } from '../../infra/docker/docker.service';
import { HostBackendBuilder } from '../../infra/builder/host-backend.builder';
import { NotifyService } from '../../infra/notify/notify.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';

const execFileAsync = promisify(execFile);

const SWEEP_MS = 60_000; // quét mỗi phút
const FAILS_TO_ALERT = 3; // 3 lần liên tiếp không trả lời (~3 phút) mới báo — tránh nhiễu
const METRIC_KEEP_DAYS = 7;
const INCIDENT_KEEP_DAYS = 30;

interface WatchedProject {
  id: string;
  slug: string;
  name: string;
  teamId: string;
  internalPort: number;
  useDocker: boolean;
  memoryMb: number; // hạn RAM cấu hình — mốc so ngưỡng cảnh báo
}

const RAM_WARN_RATIO = 0.8; // dùng ≥ 80% hạn RAM → cảnh báo
const RAM_WARN_COOLDOWN_MS = 30 * 60_000; // 30 phút/app, tránh spam

/** "123.4MiB / 512MiB" → 123.4 (MB). Hỗ trợ KiB/MiB/GiB. */
export function parseMemToMb(s: string): number | null {
  const m = s.match(/^([\d.]+)\s*(KiB|MiB|GiB|B)/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  if (unit === 'GIB') return v * 1024;
  if (unit === 'KIB') return v / 1024;
  if (unit === 'B') return v / 1024 / 1024;
  return v; // MiB
}

/**
 * C1 + C2: mỗi phút quét các app BACKEND đang RUNNING (bỏ preview PR):
 * - 📈 metrics_history: lấy mẫu CPU/RAM → bảng MetricSample (biểu đồ lịch sử).
 * - 🔴 app_uptime_monitor: gọi HTTP thử app; 3 lần liên tiếp không trả lời →
 *   mở AppIncident + báo Telegram; trả lời lại → đóng incident + báo hồi phục.
 * Khác watchdog: watchdog canh "process sống" (host-run) và tự restart;
 * monitor canh "app có TRẢ LỜI không" (cả docker) — bắt ca sống-mà-đơ.
 */
@Injectable()
export class MonitorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MonitorService.name);
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;
  /** projectId → số lần check fail liên tiếp */
  private fails = new Map<string, number>();
  /** projectId → lần cảnh báo RAM cao gần nhất (cooldown) */
  private ramWarnedAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly docker: DockerService,
    private readonly hostBackend: HostBackendBuilder,
    private readonly notify: NotifyService,
    private readonly flags: FeatureFlagsService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.sweep().catch((e) => this.warn(e)), SWEEP_MS);
    this.timer.unref?.();
    // dọn dữ liệu cũ mỗi ngày
    const p = setInterval(() => void this.prune(), 24 * 60 * 60_000);
    p.unref?.();
    void this.prune();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private warn(e: unknown): void {
    this.logger.warn(`Monitor lỗi: ${e instanceof Error ? e.message : e}`);
  }

  private async prune(): Promise<void> {
    const mCut = new Date(Date.now() - METRIC_KEEP_DAYS * 24 * 60 * 60_000);
    const iCut = new Date(Date.now() - INCIDENT_KEEP_DAYS * 24 * 60 * 60_000);
    await this.prisma.metricSample.deleteMany({ where: { at: { lt: mCut } } }).catch(() => undefined);
    await this.prisma.appIncident
      .deleteMany({ where: { endedAt: { not: null, lt: iCut } } })
      .catch(() => undefined);
  }

  private dataDir(): string {
    return resolve(process.cwd(), this.config.get<string>('DATA_DIR', '.deploybox-data'));
  }

  private async sweep(): Promise<void> {
    if (this.sweeping) return;
    const doMetrics = this.flags.isEnabled('metrics_history');
    const doUptime = this.flags.isEnabled('app_uptime_monitor');
    if (!doMetrics && !doUptime) return;
    this.sweeping = true;
    try {
      const projects: WatchedProject[] = await this.prisma.project.findMany({
        where: {
          type: 'BACKEND',
          isPreview: false,
          deployments: { some: { status: 'RUNNING' } },
        },
        select: {
          id: true, slug: true, name: true, teamId: true,
          internalPort: true, useDocker: true, memoryMb: true,
        },
      });
      for (const p of projects) {
        if (doMetrics) await this.sample(p).catch(() => undefined);
        if (doUptime) await this.checkUptime(p).catch(() => undefined);
      }
    } finally {
      this.sweeping = false;
    }
  }

  // ── C1: lấy mẫu CPU/RAM ──────────────────────────────────────────────────

  private async sample(p: WatchedProject): Promise<void> {
    let cpuPct: number | null = null;
    let memMb: number | null = null;
    if (p.useDocker) {
      const s = await this.docker.stats(`deploybox-${p.slug}`);
      if (!s) return;
      cpuPct = parseFloat(s.cpu.replace('%', ''));
      if (!Number.isFinite(cpuPct)) cpuPct = null;
      memMb = parseMemToMb(s.mem.split('/')[0].trim());
    } else {
      const pid = await this.hostBackend.getPid(this.dataDir(), p.slug);
      if (!pid) return;
      // pidfile là `sh -c` wrapper (~2MB) — app node thật là CON của nó
      // → cộng cả cây (pid + con trực tiếp) mới ra RAM/CPU thật của app
      const ps = (args: string[]) =>
        execFileAsync('ps', args).then((r) => r.stdout).catch(() => '');
      const [own, kids] = await Promise.all([
        ps(['-o', 'rss=,%cpu=', '-p', String(pid)]),
        ps(['-o', 'rss=,%cpu=', '--ppid', String(pid)]), // Linux; máy khác fail thì bỏ qua
      ]);
      let rssKb = 0;
      let cpu = 0;
      let seen = false;
      for (const line of `${own}\n${kids}`.split('\n')) {
        const [r, c] = line.trim().split(/\s+/).map((x) => parseFloat(x));
        if (Number.isFinite(r) && r > 0) {
          rssKb += r;
          seen = true;
          if (Number.isFinite(c)) cpu += c;
        }
      }
      if (seen) {
        memMb = rssKb / 1024;
        cpuPct = Math.round(cpu * 10) / 10;
      }
    }
    if (memMb == null) return;
    await this.prisma.metricSample.create({
      data: { projectId: p.id, cpuPct, memMb: Math.round(memMb * 10) / 10 },
    });
    await this.checkRamThreshold(p, memMb).catch(() => undefined);
  }

  /** ⚠️ RAM ≥ 80% hạn cấu hình → báo Telegram TRƯỚC khi OOM (cooldown 30ph/app). */
  private async checkRamThreshold(p: WatchedProject, memMb: number): Promise<void> {
    if (!this.flags.isEnabled('ram_threshold_alert')) return;
    if (!p.memoryMb || p.memoryMb <= 0) return;
    const ratio = memMb / p.memoryMb;
    if (ratio < RAM_WARN_RATIO) {
      // Đã xuống dưới ngưỡng → reset để lần vọt lên sau còn báo lại
      this.ramWarnedAt.delete(p.id);
      return;
    }
    const last = this.ramWarnedAt.get(p.id) ?? 0;
    if (Date.now() - last < RAM_WARN_COOLDOWN_MS) return;
    this.ramWarnedAt.set(p.id, Date.now());
    const pct = Math.round(ratio * 100);
    // Hệ quả tuỳ chế độ chạy — chỉ nói đúng cái app này đang dùng, khỏi gây hiểu lầm
    const consequence = p.useDocker
      ? 'App chạy Docker (giới hạn RAM cứng) — chạm hạn là container bị OOM-kill (app chết).'
      : 'App chạy thẳng trên VPS (host-run, không Docker) — RAM cao ăn chung tài nguyên VPS, dễ làm các app khác đuối.';
    await this.notifyTeam(
      p.teamId,
      `⚠️ <b>${p.name}</b> đang dùng <b>${Math.round(memMb)} MB / ${p.memoryMb} MB</b> RAM (${pct}%).\n` +
        `${consequence}\n` +
        `Cân nhắc tăng "Giới hạn RAM" trong Sửa cấu hình, hoặc tối ưu app.`,
    );
  }

  // ── C2: canh app trả lời HTTP ────────────────────────────────────────────

  private async appUrl(p: WatchedProject): Promise<string | null> {
    if (!p.useDocker) return `http://127.0.0.1:${p.internalPort}/`;
    const hostPort = await this.docker.getHostPort(`deploybox-${p.slug}`, p.internalPort);
    return hostPort ? `http://127.0.0.1:${hostPort}/` : null;
  }

  private async checkUptime(p: WatchedProject): Promise<void> {
    const url = await this.appUrl(p);
    let ok = false;
    let reason = '';
    if (!url) {
      reason = 'không tìm thấy cổng container';
    } else {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(5_000),
          redirect: 'manual',
        });
        // App trả lời là được (kể cả 404/302) — chỉ 5xx hoặc im lặng mới tính down
        ok = res.status < 500;
        if (!ok) reason = `HTTP ${res.status}`;
      } catch {
        reason = 'không trả lời (timeout 5s)';
      }
    }

    if (ok) {
      this.fails.delete(p.id);
      // đang có incident mở → hồi phục
      const open = await this.prisma.appIncident.findFirst({
        where: { projectId: p.id, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (open) {
        await this.prisma.appIncident.update({
          where: { id: open.id },
          data: { endedAt: new Date() },
        });
        const mins = Math.max(1, Math.round((Date.now() - open.startedAt.getTime()) / 60_000));
        await this.notifyTeam(
          p.teamId,
          `🟢 <b>${p.name}</b> đã hoạt động trở lại (down ~${mins} phút).`,
        );
      }
      return;
    }

    const n = (this.fails.get(p.id) ?? 0) + 1;
    this.fails.set(p.id, n);
    if (n !== FAILS_TO_ALERT) return; // chỉ báo đúng 1 lần khi chạm ngưỡng

    const open = await this.prisma.appIncident.findFirst({
      where: { projectId: p.id, endedAt: null },
    });
    if (open) return; // đã có incident mở (vd API restart giữa chừng) — không báo lại
    await this.prisma.appIncident.create({
      data: { projectId: p.id, reason },
    });
    await this.notifyTeam(
      p.teamId,
      `🔴 <b>${p.name}</b> KHÔNG trả lời ${FAILS_TO_ALERT} phút liền (${reason}).\n` +
        `Xem log ở trang project — watchdog sẽ tự cứu nếu process chết; app "đơ" thì cần Deploy lại.`,
    );
  }

  private async notifyTeam(teamId: string, html: string): Promise<void> {
    const members = await this.prisma.teamMember.findMany({
      where: { teamId },
      select: { user: { select: { telegramChatId: true } } },
    });
    await this.notify
      .broadcast(html, members.map((m) => m.user.telegramChatId).filter((x): x is string => !!x))
      .catch(() => undefined);
  }

  // ── API cho web ──────────────────────────────────────────────────────────

  private async assertAccess(userId: string, projectId: string): Promise<void> {
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
  }

  /** Lịch sử CPU/RAM — gộp bucket để trả ≤ ~360 điểm dù xem 7 ngày. */
  async history(userId: string, projectId: string, hours: number): Promise<MetricPointDto[]> {
    await this.assertAccess(userId, projectId);
    const h = Math.min(Math.max(1, hours), 24 * 7);
    const from = new Date(Date.now() - h * 60 * 60_000);
    const rows = await this.prisma.metricSample.findMany({
      where: { projectId, at: { gte: from } },
      orderBy: { at: 'asc' },
      select: { at: true, cpuPct: true, memMb: true },
    });
    // 1 mẫu/phút → gộp trung bình theo bucket cho nhẹ payload
    const bucketMin = Math.max(1, Math.ceil((h * 60) / 360));
    const buckets = new Map<number, { t: number; cpu: number[]; mem: number[] }>();
    for (const r of rows) {
      const key = Math.floor(r.at.getTime() / (bucketMin * 60_000));
      let b = buckets.get(key);
      if (!b) {
        b = { t: key * bucketMin * 60_000, cpu: [], mem: [] };
        buckets.set(key, b);
      }
      if (r.cpuPct != null) b.cpu.push(r.cpuPct);
      b.mem.push(r.memMb);
    }
    const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
    return [...buckets.values()].map((b) => ({
      at: new Date(b.t).toISOString(),
      cpuPct: avg(b.cpu) != null ? Math.round((avg(b.cpu) as number) * 10) / 10 : null,
      memMb: Math.round((avg(b.mem) ?? 0) * 10) / 10,
    }));
  }

  /** Trạng thái canh app + các sự cố gần nhất. */
  async uptime(userId: string, projectId: string): Promise<UptimeStatusDto> {
    await this.assertAccess(userId, projectId);
    const incidents = await this.prisma.appIncident.findMany({
      where: { projectId },
      orderBy: { startedAt: 'desc' },
      take: 10,
    });
    const toDto = (i: (typeof incidents)[number]): AppIncidentDto => ({
      id: i.id,
      startedAt: i.startedAt.toISOString(),
      endedAt: i.endedAt?.toISOString() ?? null,
      reason: i.reason,
    });
    return {
      isDown: incidents.some((i) => !i.endedAt),
      incidents: incidents.map(toDto),
    };
  }

  /** URL công khai (khớp CaddyService.publicUrl) — không import Caddy để tránh vòng phụ thuộc. */
  private publicUrl(slug: string): string {
    const domain = this.config.get<string>('APP_DOMAIN', 'localhost');
    const port = this.config.get<string>('PROXY_PORT', '8080');
    return domain === 'localhost'
      ? `http://${slug}.${domain}:${port}/`
      : `https://${slug}.${domain}/`;
  }

  /** 📊 Tổng quan: mọi app user truy cập được + status + RAM/CPU mới nhất + đang down? */
  async overview(userId: string): Promise<OverviewItemDto[]> {
    const projects = await this.prisma.project.findMany({
      where: {
        isPreview: false,
        OR: [
          { team: { members: { some: { userId, role: 'OWNER' } } } },
          { members: { some: { userId } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, slug: true, type: true, memoryMb: true,
        deployments: { orderBy: { queuedAt: 'desc' }, take: 1, select: { status: true } },
        metricSamples: { orderBy: { at: 'desc' }, take: 1, select: { cpuPct: true, memMb: true, at: true } },
        incidents: { where: { endedAt: null }, take: 1, select: { id: true } },
      },
    });
    return projects.map((p) => {
      const status = p.deployments[0]?.status ?? 'NONE';
      const s = p.metricSamples[0];
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        type: p.type,
        status,
        url: status === 'RUNNING' ? this.publicUrl(p.slug) : null,
        cpuPct: s?.cpuPct ?? null,
        memMb: s?.memMb ?? null,
        memoryMb: p.memoryMb,
        isDown: p.incidents.length > 0,
        updatedAt: s?.at?.toISOString() ?? null,
      };
    });
  }
}
