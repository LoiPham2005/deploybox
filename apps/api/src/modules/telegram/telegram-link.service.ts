import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { randomBytes as rb } from 'crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { DeploymentsService } from '../deployments/deployments.service';
import { AiService } from '../../infra/ai/ai.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';

const TG = 'https://api.telegram.org';

const HELP_TEXT = [
  '🤖 DeployBox bot — bạn có thể:',
  '• Hỏi tự do: "vì sao app tôi deploy fail?", "app nào đang chạy?"…',
  '• /status — trạng thái các project của bạn',
  '• /deploy <tên app> — deploy lại (có nút xác nhận)',
  '• /stop <tên app> — tắt app (có nút xác nhận)',
  '• Gửi ẢNH chụp màn hình lỗi (kèm câu hỏi) — AI đọc ảnh chẩn đoán',
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

  /** Hành động chờ xác nhận (nút inline): token → chi tiết */
  private pendingActions = new Map<
    string,
    { fromId: string; dbUserId: string; action: 'deploy' | 'stop'; projectId: string; projectName: string; expires: number }
  >();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly flags: FeatureFlagsService,
    private readonly deployments: DeploymentsService,
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
    // Nút xác nhận hành động (inline keyboard)
    if (u.callback_query) {
      await this.handleCallback(u.callback_query);
      return;
    }
    const m = u.message;
    if (!m || !m.chat) return;
    const chatId = String(m.chat.id);

    // 🖼 Ảnh gửi cho bot (chat riêng) → AI đọc ảnh chẩn đoán
    if (Array.isArray(m.photo) && m.photo.length) {
      await this.handlePhoto(m, chatId);
      return;
    }

    if (typeof m.text !== 'string') return;
    const text: string = m.text.trim();

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

    // 🎮 Lệnh hành động: /deploy <tên> | /stop <tên> — có nút xác nhận, đúng quyền
    const act = question.match(/^\/?(deploy|stop)\s+(.+)$/i);
    if (act) {
      await this.handleActionCommand(
        chatId,
        fromId,
        user.id,
        act[1].toLowerCase() as 'deploy' | 'stop',
        act[2].trim(),
      );
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

  /** 🖼 Nhận ảnh → tải về → AI vision chẩn đoán (kèm caption làm câu hỏi). */
  private async handlePhoto(m: any, chatId: string): Promise<void> {
    // Trong nhóm chỉ xử lý khi caption có nhắc @bot (tránh đọc mọi ảnh của nhóm)
    const isGroup = m.chat.type !== 'private';
    const caption: string = (m.caption ?? '').trim();
    if (isGroup) {
      const mentioned =
        !!this.botUsername && caption.toLowerCase().includes(`@${this.botUsername.toLowerCase()}`);
      if (!mentioned) return;
    }
    if (!this.flags.aiEnabled('ai_photo_diagnosis')) {
      await this.send(chatId, '💤 Tính năng đọc ảnh đang tắt (Admin → Tính năng hệ thống).');
      return;
    }
    const fromId = String(m.from?.id ?? '');
    const user = await this.prisma.user.findFirst({
      where: { telegramChatId: fromId },
      select: { id: true },
    });
    if (!user) {
      await this.send(chatId, '❗ Bạn chưa kết nối tài khoản DeployBox — vào web → Tài khoản → Kết nối Telegram.');
      return;
    }
    // Rate-limit chung với hỏi đáp
    const now = Date.now();
    if ((this.lastAsk.get(fromId) ?? 0) + 10_000 > now) {
      await this.send(chatId, '⏳ Từ từ nhé — 10 giây mới hỏi được 1 câu.');
      return;
    }
    this.lastAsk.set(fromId, now);
    await this.sendChatAction(chatId, 'typing');

    try {
      // Ảnh to nhất (phần tử cuối), tải qua getFile
      const fileId = m.photo[m.photo.length - 1].file_id;
      const info = await fetch(`${TG}/bot${this.token}/getFile?file_id=${fileId}`, {
        signal: AbortSignal.timeout(15_000),
      }).then((r) => r.json() as Promise<any>);
      const path = info?.result?.file_path;
      if (!path) throw new Error('Không tải được ảnh từ Telegram');
      const ab = await fetch(`${TG}/file/bot${this.token}/${path}`, {
        signal: AbortSignal.timeout(30_000),
      }).then((r) => r.arrayBuffer());
      const buf = Buffer.from(new Uint8Array(ab));
      if (buf.length > 6_000_000) throw new Error('Ảnh quá lớn (>6MB)');
      const mime = path.endsWith('.png') ? 'image/png' : 'image/jpeg';

      const ctx = await this.buildProjectContext(user.id);
      const question = this.botUsername
        ? caption.replace(new RegExp(`@${this.botUsername}`, 'ig'), '').trim()
        : caption;
      const answer = await this.ai.analyzeImage(
        question,
        ctx.aiContext,
        buf.toString('base64'),
        mime,
      );
      await this.send(chatId, `🖼 ${answer}`.slice(0, 3500));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.send(chatId, `⚠️ ${msg}`.slice(0, 400));
    }
  }

  /** 🎮 Xử lý /deploy | /stop: tìm project theo tên → gửi nút xác nhận. */
  private async handleActionCommand(
    chatId: string,
    fromId: string,
    dbUserId: string,
    action: 'deploy' | 'stop',
    query: string,
  ): Promise<void> {
    if (!this.flags.aiEnabled('ai_bot_actions')) {
      await this.send(chatId, '💤 Tính năng thao tác qua bot đang tắt (Admin → Tính năng hệ thống).');
      return;
    }
    const projects = await this.accessibleProjects(dbUserId);
    const q = query.toLowerCase();
    const matches = projects.filter(
      (p) => p.slug.toLowerCase() === q || p.name.toLowerCase() === q,
    );
    const fuzzy = matches.length
      ? matches
      : projects.filter(
          (p) => p.slug.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
        );
    if (!fuzzy.length) {
      await this.send(chatId, `Không tìm thấy app "${query}" trong các project của bạn. Gõ /status để xem danh sách.`);
      return;
    }
    if (fuzzy.length > 1) {
      await this.send(
        chatId,
        `Có ${fuzzy.length} app khớp "${query}":\n` +
          fuzzy.map((p) => `• ${p.slug}`).join('\n') +
          `\nGõ lại chính xác: /${action} <slug>`,
      );
      return;
    }

    const project = fuzzy[0];
    const token = rb(8).toString('hex');
    this.pendingActions.set(token, {
      fromId,
      dbUserId,
      action,
      projectId: project.id,
      projectName: project.name,
      expires: Date.now() + 2 * 60_000,
    });
    // Dọn token hết hạn
    for (const [k, v] of this.pendingActions) if (v.expires < Date.now()) this.pendingActions.delete(k);

    const verb = action === 'deploy' ? '🚀 Deploy lại' : '🛑 Tắt';
    await this.tgApi('sendMessage', {
      chat_id: chatId,
      text: `${verb} app "${project.name}"?`,
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Xác nhận', callback_data: `act:${token}:y` },
          { text: '❌ Huỷ', callback_data: `act:${token}:n` },
        ]],
      },
    });
  }

  /** Bấm nút xác nhận/huỷ. */
  private async handleCallback(cb: any): Promise<void> {
    const data = String(cb.data ?? '');
    const chatId = String(cb.message?.chat?.id ?? '');
    const fromId = String(cb.from?.id ?? '');
    const answer = (text: string) =>
      this.tgApi('answerCallbackQuery', { callback_query_id: cb.id, text });

    const m = data.match(/^act:([a-f0-9]+):(y|n)$/);
    if (!m) { await answer(''); return; }
    const pending = this.pendingActions.get(m[1]);
    if (!pending || pending.expires < Date.now()) {
      await answer('Hết hạn — gõ lại lệnh nhé.');
      return;
    }
    if (pending.fromId !== fromId) {
      await answer('Nút này không dành cho bạn 😅');
      return;
    }
    this.pendingActions.delete(m[1]);

    const editText = (text: string) =>
      this.tgApi('editMessageText', {
        chat_id: chatId,
        message_id: cb.message?.message_id,
        text,
      });

    if (m[2] === 'n') {
      await answer('Đã huỷ');
      await editText(`❌ Đã huỷ ${pending.action} "${pending.projectName}".`);
      return;
    }

    try {
      if (pending.action === 'deploy') {
        const dep = await this.deployments.deploy(pending.dbUserId, pending.projectId);
        await answer('Đã xếp hàng deploy 🚀');
        await editText(
          `🚀 Đã xếp hàng deploy "${pending.projectName}" (bản ${dep.id.slice(0, 8)}). Kết quả sẽ báo về đây.`,
        );
      } else {
        await this.deployments.stop(pending.dbUserId, pending.projectId);
        await answer('Đã tắt app 🛑');
        await editText(`🛑 Đã tắt app "${pending.projectName}".`);
      }
      this.logger.log(`Bot action: ${pending.action} ${pending.projectName} bởi user ${pending.dbUserId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await answer('Lỗi');
      await editText(`⚠️ ${pending.action} "${pending.projectName}" thất bại: ${msg.slice(0, 200)}`);
    }
  }

  /** Project user có quyền dùng (OWNER team → tất cả; MEMBER → được cấp). */
  private async accessibleProjects(
    userId: string,
  ): Promise<{ id: string; name: string; slug: string }[]> {
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true, role: true },
    });
    const ownerTeams = memberships.filter((m) => m.role === 'OWNER').map((m) => m.teamId);
    const memberTeams = memberships.filter((m) => m.role !== 'OWNER').map((m) => m.teamId);
    return this.prisma.project.findMany({
      where: {
        OR: [
          { teamId: { in: ownerTeams } },
          { teamId: { in: memberTeams }, members: { some: { userId } } },
        ],
      },
      select: { id: true, name: true, slug: true },
      take: 50,
    });
  }

  /** Gọi Telegram API method bất kỳ (im lặng nếu lỗi). */
  private async tgApi(method: string, body: Record<string, unknown>): Promise<void> {
    try {
      await fetch(`${TG}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      /* im lặng */
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
