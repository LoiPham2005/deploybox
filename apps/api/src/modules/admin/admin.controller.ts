import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly flags: FeatureFlagsService,
  ) {}

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
