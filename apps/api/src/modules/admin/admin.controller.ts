import { Body, Controller, Get, Param, Patch, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';
import { AiService } from '../../infra/ai/ai.service';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly flags: FeatureFlagsService,
    private readonly ai: AiService,
  ) {}

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
