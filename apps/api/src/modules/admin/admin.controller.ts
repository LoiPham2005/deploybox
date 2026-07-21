import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';
import { AiService } from '../../infra/ai/ai.service';
import { AuditService } from '../../infra/audit/audit.service';
import { ReportService } from '../deployments/report.service';
import { BillingConfigService } from '../billing/billing-config.service';
import { BackupService } from '../../infra/backup/backup.service';
import { CaptchaService } from '../../infra/captcha/captcha.service';
import { CleanupService } from '../../infra/cleanup/cleanup.service';
import type { BillingConfigPatch } from '@deploybox/shared';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly flags: FeatureFlagsService,
    private readonly ai: AiService,
    private readonly audit: AuditService,
    private readonly report: ReportService,
    private readonly billing: BillingConfigService,
    private readonly backup: BackupService,
    private readonly captchaSvc: CaptchaService,
    private readonly cleanup: CleanupService,
  ) {}

  /** 💽 Dung lượng đĩa (còn/tổng). */
  @Get('disk')
  diskInfo() {
    return this.cleanup.diskInfo();
  }

  /** 🧹 Dọn dung lượng ngay: docker prune + build cache + work/ tạm + log rác. */
  @Post('disk/clean')
  cleanDisk() {
    return this.cleanup.cleanNow();
  }

  /** 🤖 Turnstile: xem/lưu key (secret mã hoá, không trả về UI). */
  @Get('captcha')
  captchaView() {
    return this.captchaSvc.adminView();
  }

  @Put('captcha')
  setCaptcha(@Body() body: { siteKey?: string; secretKey?: string; clearSecret?: boolean }) {
    return this.captchaSvc.save(body ?? {});
  }

  /** 💾 Sao lưu: trạng thái backup + DB đang dùng (chính/phụ). */
  @Get('backup')
  backupStatus() {
    return this.backup.status();
  }

  /** Chạy backup ngay (dump → local + đẩy sang DB phụ). */
  @Post('backup/run')
  backupRun() {
    return this.backup.run();
  }

  /** Đổi NƠI NHẬN backup (URL DB phụ) — test kết nối rồi mới lưu (file trên đĩa). */
  @Put('backup/target')
  setBackupTarget(@Body() body: { url?: string; clear?: boolean }) {
    return this.backup.setTarget(body?.url, body?.clear);
  }

  /** Chuyển DB chính ↔ DB dự phòng. Ghi file failover xong RESTART API
   *  (pm2 tự kéo dậy) — trả lời trước, thoát sau 1.2s. */
  @Post('backup/failover')
  async backupFailover(@Body() body: { useBackup: boolean }) {
    await this.backup.setFailover(!!body?.useBackup);
    setTimeout(() => process.exit(0), 1200);
    return { ok: true, restarting: true };
  }

  /** Cấu hình thanh toán (giá + TK nhận tiền + key SePay) — admin sửa ở UI. */
  @Get('billing')
  billingConfig() {
    return this.billing.adminView();
  }

  @Put('billing')
  setBillingConfig(@Body() body: BillingConfigPatch) {
    return this.billing.save(body ?? {});
  }

  /** 📝 Nhật ký hoạt động: ai làm gì lúc nào (?limit=100&email=lọc). */
  @Get('audit')
  auditList(@Query('limit') limit?: string, @Query('email') email?: string) {
    return this.audit.list(limit ? parseInt(limit, 10) || 100 : 100, email || undefined);
  }

  /** Xem trước báo cáo ngày/tuần (?days=1|7) — không gửi Telegram. */
  @Get('report')
  async reportPreview(@Query('days') days?: string) {
    const d = days === '7' ? 7 : 1;
    const text = await this.report.buildReport(d);
    return { days: d, text: text || '(Không có hoạt động nào trong kỳ)' };
  }

  /** 💰 Chi phí AI theo tính năng/model (ước tính, ?days=30). */
  @Get('ai-usage')
  aiUsage(@Query('days') days?: string) {
    const d = days ? parseInt(days, 10) || 30 : 30;
    return this.ai.usageSummary(Math.min(Math.max(d, 1), 365));
  }

  /** Cấu hình AI: provider/model đang chọn + danh sách nhà cung cấp. */
  @Get('ai')
  aiConfig() {
    return this.ai.status();
  }

  /** Admin đổi provider + model dùng cho toàn app. */
  @Put('ai')
  setAiConfig(@Body() body: { provider: string; model: string }) {
    return this.ai.setConfig(body.provider, body.model);
  }

  /** Admin đặt/sửa API key cho 1 nhà cung cấp (mã hoá, lưu DB). apiKey rỗng = xoá → về .env. */
  @Put('ai/key')
  setAiKey(@Body() body: { provider: string; apiKey: string }) {
    return this.ai.setKey(body.provider, body.apiKey ?? '');
  }

  @Get('features')
  features() {
    return this.flags.list();
  }

  @Patch('features/:key')
  setFeature(@Param('key') key: string, @Body() body: { enabled: boolean }) {
    return this.flags.setEnabled(key, !!body.enabled);
  }

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  @Get('users')
  listUsers() {
    return this.admin.listUsers();
  }

  @Patch('teams/:teamId/plan')
  upgradePlan(
    @Param('teamId') teamId: string,
    @Body() body: { plan: 'FREE' | 'PRO' },
  ) {
    return this.admin.upgradePlan(teamId, body.plan);
  }
}
