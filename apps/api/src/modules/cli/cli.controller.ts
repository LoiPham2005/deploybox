import { Controller, ForbiddenException, Get, UseGuards } from '@nestjs/common';
import { JwtOrApiTokenGuard } from '../../common/guards/jwt-or-api-token.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/guards/jwt-auth.guard';
import { ProjectsService } from '../projects/projects.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';

/**
 * Endpoint dành cho CLI `deploybox` — nhận CẢ JWT lẫn API token (deploybox_…).
 * Deploy + stream log dùng lại route sẵn có ở DeploymentsController (cũng JwtOrApiToken).
 * Tắt flag `cli_api` (Admin → Tính năng hệ thống) = CLI không dùng được.
 */
@UseGuards(JwtOrApiTokenGuard)
@Controller('cli')
export class CliController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly flags: FeatureFlagsService,
  ) {}

  private assertOn(): void {
    if (!this.flags.isEnabled('cli_api')) {
      throw new ForbiddenException(
        'CLI deploybox đang tắt (Admin → Tính năng hệ thống).',
      );
    }
  }

  /** Xác minh token + trả email đang dùng. */
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    this.assertOn();
    return { email: user.email };
  }

  /** Mọi project token này truy cập được (mọi team) — để list + resolve slug→id. */
  @Get('projects')
  projectsList(@CurrentUser() user: JwtPayload) {
    this.assertOn();
    return this.projects.listAccessible(user.sub);
  }
}
