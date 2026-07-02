import { Body, Controller, Get, Param, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';
import { AiService } from '../../infra/ai/ai.service';
import { ReportService } from '../deployments/report.service';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly flags: FeatureFlagsService,
    private readonly ai: AiService,
    private readonly report: ReportService,
  ) {}

  /** Xem trước báo cáo ngày/tuần (?days=1|7) — không gửi Telegram. */
  @Get('report')
  async reportPreview(@Query('days') days?: string) {
    const d = days === '7' ? 7 : 1;
    const text = await this.report.buildReport(d);
    return { days: d, text: text || '(Không có hoạt động nào trong kỳ)' };
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
