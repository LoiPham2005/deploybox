import { Body, Controller, Get, Param, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';
import { AiService } from '../../infra/ai/ai.service';
import { AuditService } from '../../infra/audit/audit.service';
import { ReportService } from '../deployments/report.service';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly flags: FeatureFlagsService,
    private readonly ai: AiService,
    private readonly audit: AuditService,
    private readonly report: ReportService,
  ) {}

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
