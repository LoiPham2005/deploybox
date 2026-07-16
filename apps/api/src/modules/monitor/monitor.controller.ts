import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { MonitorService } from './monitor.service';
import { JwtAuthGuard, type JwtPayload } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';

@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId')
export class MonitorController {
  constructor(private readonly monitor: MonitorService) {}

  /** 📈 Lịch sử CPU/RAM (?hours=24, tối đa 168). */
  @Get('metrics/history')
  history(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
    @Query('hours') hours?: string,
  ) {
    return this.monitor.history(user.sub, projectId, hours ? parseInt(hours, 10) || 24 : 24);
  }

  /** 🔴 Trạng thái canh app + sự cố gần nhất. */
  @Get('uptime')
  uptime(@CurrentUser() user: JwtPayload, @Param('projectId') projectId: string) {
    return this.monitor.uptime(user.sub, projectId);
  }
}

/** 📊 Tổng quan mọi app (không gắn 1 project) — route riêng ngoài prefix projects/:id. */
@UseGuards(JwtAuthGuard)
@Controller('overview')
export class OverviewController {
  constructor(private readonly monitor: MonitorService) {}

  @Get()
  overview(@CurrentUser() user: JwtPayload) {
    return this.monitor.overview(user.sub);
  }
}

/** 🌐 PUBLIC — trạng thái app cho trang /status (flag public_status_page). */
@Controller('public')
export class PublicStatusController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @Get('status')
  async status() {
    if (!this.flags.isEnabled('public_status_page')) {
      throw new NotFoundException();
    }
    const projects = await this.prisma.project.findMany({
      where: { isPreview: false },
      orderBy: { createdAt: 'asc' },
      select: {
        name: true,
        type: true,
        deployments: {
          orderBy: { queuedAt: 'desc' },
          take: 1,
          select: { status: true, finishedAt: true },
        },
      },
    });
    return {
      generatedAt: new Date().toISOString(),
      services: projects.map((p) => ({
        name: p.name,
        type: p.type,
        status: p.deployments[0]?.status ?? 'UNKNOWN',
      })),
    };
  }
}
