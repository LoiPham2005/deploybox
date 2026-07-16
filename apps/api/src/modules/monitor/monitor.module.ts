import { Module } from '@nestjs/common';
import { MonitorService } from './monitor.service';
import { MonitorController, OverviewController, PublicStatusController } from './monitor.controller';
import { AuthModule } from '../auth/auth.module';
import { CaddyModule } from '../../infra/caddy/caddy.module';
import { HostBackendBuilder } from '../../infra/builder/host-backend.builder';
import { NotifyService } from '../../infra/notify/notify.service';

@Module({
  imports: [AuthModule, CaddyModule], // CaddyModule export DockerService
  controllers: [MonitorController, OverviewController, PublicStatusController],
  providers: [MonitorService, HostBackendBuilder, NotifyService],
})
export class MonitorModule {}
