import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtOrApiTokenGuard } from '../../common/guards/jwt-or-api-token.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/guards/jwt-auth.guard';
import { ProjectsService } from '../projects/projects.service';

/**
 * Endpoint dành cho CLI `deploybox` — nhận CẢ JWT lẫn API token (deploybox_…).
 * Deploy + stream log dùng lại route sẵn có ở DeploymentsController (cũng JwtOrApiToken).
 */
@UseGuards(JwtOrApiTokenGuard)
@Controller('cli')
export class CliController {
  constructor(private readonly projects: ProjectsService) {}

  /** Xác minh token + trả email đang dùng. */
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return { email: user.email };
  }

  /** Mọi project token này truy cập được (mọi team) — để list + resolve slug→id. */
  @Get('projects')
  projectsList(@CurrentUser() user: JwtPayload) {
    return this.projects.listAccessible(user.sub);
  }
}
