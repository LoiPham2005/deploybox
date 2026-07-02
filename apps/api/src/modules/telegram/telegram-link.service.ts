import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AiService } from '../../infra/ai/ai.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';

const TG = 'https://api.telegram.org';

const HELP_TEXT = [
  '🤖 DeployBox bot — bạn có thể:',
  '• Hỏi tự do: "vì sao app tôi deploy fail?", "app nào đang chạy?"…',
  '• /status — trạng thái các project của bạn',
  '• /help — tin nhắn này',
  '',
  'Trong nhóm: nhắc @bot để hỏi. Chat riêng: nhắn thẳng.',
].join('\n');

/**
 * Bot Telegram của instance (1 bot chung):
 *  1. KẾT NỐI tài khoản qua deep-link: `t.me/<bot>?start=<mã>` → bắt `/start <mã>` → lưu chat_id.
 *  2. HỎI ĐÁP AI: user đã nối nhắn câu hỏi → lấy dữ liệu project HỌ CÓ QUYỀN XEM → AI trả lời.
 * Poller là consumer DUY NHẤT của getUpdates (đừng gọi getUpdates thủ công nơi khác).
 */
@Injectable()
export class TelegramLinkService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TelegramLinkService.name);
  private token = '';
  private botUsername: string | null = null;
  private offset = 0;
  private running = false;
  /** telegram from.id → mốc lần hỏi AI gần nhất (rate-limit 10s/lần) */
  private lastAsk = new Map<string, number>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly flags: FeatureFlagsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.token = this.config.get<string>('TELEGRAM_BOT_TOKEN') ?? '';
    if (!this.token) {
      this.logger.log('TELEGRAM_BOT_TOKEN chưa đặt → bỏ qua kết nối Telegram.');
      return;
    }
    this.botUsername = await this.fetchBotUsername();
    if (this.botUsername) this.logger.log(`Bot Telegram: @${this.botUsername} — bắt đầu lắng nghe /start.`);
    this.running = true;
    void this.pollLoop();
  }

  onModuleDestroy(): void {
    this.running = false;
  }

  /** Username của bot (cho deep-link). Null nếu chưa cấu hình. */
  getBotUsername(): string | null {
    return this.botUsername;
  }

  isEnabled(): boolean {
    return !!this.token;
  }

  /** Sinh mã link mới cho user + trả về deep-link. */
  async createLink(userId: string): Promise<{ url: string; botUsername: string } | null> {
    if (!this.token || !this.botUsername) return null;
    const code = randomBytes(12).toString('hex');
    await this.prisma.user.update({ where: { id: userId }, data: { telegramLinkCode: code } });
    return { url: `https://t.me/${this.botUsername}?start=${code}`, botUsername: this.botUsername };
  }

  private async fetchBotUsername(): Promise<string | null> {
    try {
      const r = await fetch(`${TG}/bot${this.token}/getMe`, { signal: AbortSignal.timeout(10_000) });
      const j = (await r.json()) as any;
      return j.ok ? j.result.username : null;
    } catch (e) {
      this.logger.warn(`getMe lỗi: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  /** Vòng lặp long-poll getUpdates. */
  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const r = await fetch(`${TG}/bot${this.token}/getUpdates?timeout=25&offset=${this.offset}`, {
          signal: AbortSignal.timeout(35_000),
        });
        const j = (await r.json()) as any;
        if (j.ok && Array.isArray(j.result)) {
          for (const u of j.result) {
            this.offset = u.update_id + 1;
            await this.handleUpdate(u).catch((e) =>
              this.logger.warn(`Xử lý update lỗi: ${e instanceof Error ? e.message : e}`),
            );
          }
        }
      } catch {
        // mạng lỗi / timeout → nghỉ chút rồi thử lại
        await new Promise((res) => setTimeout(res, 3000));
      }
    }
  }

  private async handleUpdate(u: any): Promise<void> {
    const m = u.message;
    if (!m || typeof m.text !== 'string' || !m.chat) return;
    const text: string = m.text.trim();
    const chatId = String(m.chat.id);

    // 1) "/start <code>" — kết nối tài khoản (deep-link)
    const match = text.match(/^\/start(?:@\w+)?\s+(\S+)/);
    if (match) {
      const user = await this.prisma.user.findUnique({
        where: { telegramLinkCode: match[1] },
      });
      if (!user) return; // mã sai/hết hạn
      await this.prisma.user.update({
        where: { id: user.id },
        data: { telegramChatId: chatId, telegramLinkCode: null },
      });
      this.logger.log(`User ${user.email} đã nối Telegram (chat ${chatId}).`);
      await this.send(
        chatId,
        `✅ Đã kết nối DeployBox!\nTừ giờ bạn nhận thông báo deploy ở đây — và có thể HỎI trực tiếp:\n"vì sao app tôi fail?", /status, /help`,
      );
      return;
    }

    // 2) "/start" trơn — chào + hướng dẫn
    if (/^\/start(?:@\w+)?$/.test(text)) {
      await this.send(chatId, HELP_TEXT);
      return;
    }

    // 3) Hỏi đáp — trong nhóm chỉ trả lời khi nhắc @bot hoặc reply tin của bot
    const isGroup = m.chat.type !== 'private';
    if (isGroup) {
      const mentioned =
        !!this.botUsername &&
        text.toLowerCase().includes(`@${this.botUsername.toLowerCase()}`);
      const repliedToBot =
        m.reply_to_message?.from?.username &&
        m.reply_to_message.from.username === this.botUsername;
      if (!mentioned && !repliedToBot) return;
    }

    // Nhận diện người hỏi: chat riêng thì chat_id == from.id (đã lưu khi nối)
    const fromId = String(m.from?.id ?? '');
    if (!fromId) return;
    const user = await this.prisma.user.findFirst({
      where: { telegramChatId: fromId },
      select: { id: true, email: true },
    });
    if (!user) {
      await this.send(
        chatId,
        '❗ Bạn chưa kết nối tài khoản DeployBox.\nVào web → Tài khoản → "Kết nối Telegram" rồi thử lại.',
      );
      return;
    }

    // Bỏ phần nhắc @bot khỏi câu hỏi
    const question = this.botUsername
      ? text.replace(new RegExp(`@${this.botUsername}`, 'ig'), '').trim()
      : text;

    if (/^\/help/i.test(question)) {
      await this.send(chatId, HELP_TEXT);
      return;
    }

    const ctx = await this.buildProjectContext(user.id);

    if (/^\/status/i.test(question)) {
      await this.send(chatId, ctx.statusText); // không tốn AI
      return;
    }

    // Hỏi đáp AI — tôn trọng công tắc riêng + nút tổng ở Admin
    if (!this.flags.aiEnabled('ai_telegram_qa')) {
      await this.send(chatId, '💤 Tính năng hỏi đáp AI đang tắt. /status vẫn dùng được nhé.');
      return;
    }

    // Rate-limit hỏi AI: 10s/lần mỗi người
    const now = Date.now();
    if ((this.lastAsk.get(fromId) ?? 0) + 10_000 > now) {
      await this.send(chatId, '⏳ Từ từ nhé — 10 giây mới hỏi được 1 câu.');
      return;
    }
    this.lastAsk.set(fromId, now);

    await this.sendChatAction(chatId, 'typing');
    try {
      const answer = await this.ai.answer(question, ctx.aiContext);
      await this.send(chatId, `🤖 ${answer}`.slice(0, 3500));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.send(chatId, `⚠️ ${msg}`.slice(0, 500));
    }
  }

  /**
   * Dữ liệu project user CÓ QUYỀN XEM (OWNER team → tất cả; MEMBER → project được cấp).
   * Trả về statusText (cho /status) + aiContext (cho AI).
   */
  private async buildProjectContext(
    userId: string,
  ): Promise<{ statusText: string; aiContext: string }> {
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true, role: true },
    });
    const ownerTeams = memberships.filter((m) => m.role === 'OWNER').map((m) => m.teamId);
    const memberTeams = memberships.filter((m) => m.role !== 'OWNER').map((m) => m.teamId);

    const projects = await this.prisma.project.findMany({
      where: {
        OR: [
          { teamId: { in: ownerTeams } },
          { teamId: { in: memberTeams }, members: { some: { userId } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: {
        name: true, slug: true, type: true, useDocker: true,
        gitBranch: true, internalPort: true,
        deployments: {
          orderBy: { queuedAt: 'desc' },
          take: 1,
          select: {
            status: true, queuedAt: true, finishedAt: true,
            errorMessage: true, aiDiagnosis: true,
          },
        },
      },
    });

    if (!projects.length) {
      const empty = 'Bạn chưa có project nào.';
      return { statusText: empty, aiContext: empty };
    }

    const STATUS_ICON: Record<string, string> = {
      RUNNING: '🟢', FAILED: '🔴', STOPPED: '⚪', BUILDING: '🟡',
      QUEUED: '🟡', DEPLOYING: '🟡', SLEEPING: '💤', CANCELLED: '⚪',
    };
    const statusLines = projects.map((p) => {
      const d = p.deployments[0];
      const st = d?.status ?? 'CHƯA DEPLOY';
      return `${STATUS_ICON[st] ?? '⚪'} ${p.name} — ${st}`;
    });
    const statusText = `📦 Project của bạn:\n${statusLines.join('\n')}`;

    const ctxBlocks = projects.map((p) => {
      const d = p.deployments[0];
      const diag = d?.aiDiagnosis as { cause?: string; fix?: string } | null;
      return [
        `• ${p.name} (slug: ${p.slug}, loại ${p.type}, nhánh ${p.gitBranch}, port ${p.internalPort}, ${p.useDocker ? 'Docker' : 'chạy host'})`,
        `  Deploy gần nhất: ${d ? `${d.status} lúc ${(d.finishedAt ?? d.queuedAt).toISOString()}` : 'chưa có'}`,
        d?.errorMessage ? `  Lỗi: ${d.errorMessage.slice(0, 300)}` : null,
        diag?.cause ? `  AI chẩn đoán: ${diag.cause.slice(0, 300)}` : null,
        diag?.fix ? `  Cách sửa: ${diag.fix.slice(0, 300)}` : null,
      ]
        .filter(Boolean)
        .join('\n');
    });
    return { statusText, aiContext: ctxBlocks.join('\n\n') };
  }

  /** Hiện "đang gõ…" cho mượt trong lúc chờ AI. */
  private async sendChatAction(chatId: string, action: string): Promise<void> {
    try {
      await fetch(`${TG}/bot${this.token}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, action }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      /* im lặng */
    }
  }

  private async send(chatId: string, text: string): Promise<void> {
    try {
      await fetch(`${TG}/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      /* im lặng */
    }
  }
}
