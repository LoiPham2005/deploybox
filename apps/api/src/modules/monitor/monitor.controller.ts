import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { MonitorService } from './monitor.service';
import { JwtAuthGuard, type JwtPayload } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

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
