import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DeploymentsController } from './deployments.controller';
import { DeploymentsService } from './deployments.service';
import { BuildProcessor } from './build.processor';
import { BuildRunnerService } from './build.runner.service';
import { ReportService } from './report.service';
import { HostStaticBuilder } from '../../infra/builder/host-static.builder';
import { DockerBackendEngine } from '../../infra/builder/docker-backend.engine';
import { HostBackendBuilder } from '../../infra/builder/host-backend.builder';
import { HostRunReconcilerService } from './host-run-reconciler.service';
import { MobileBuilder } from '../../infra/builder/mobile.builder';
import { CleanupService } from '../../infra/cleanup/cleanup.service';
import { NotifyService } from '../../infra/notify/notify.service';
import { SleepService } from '../../infra/sleep/sleep.service';
import { LogBroadcastService } from '../../infra/log-broadcast/log-broadcast.service';
import { WakeController } from './wake.controller';
import { AuthModule } from '../auth/auth.module';
import { EnvModule } from '../env/env.module';
import { CaddyModule } from '../../infra/caddy/caddy.module';
import { ServersModule } from '../servers/servers.module';
import { GitModule } from '../git/git.module';
import { BUILD_QUEUE } from './queue.constants';

const USE_REDIS = !!(process.env.REDIS_URL ?? '');

@Module({
  imports: [
    AuthModule,
    EnvModule,
    CaddyModule,
    ServersModule,
    GitModule,
    // Đăng ký queue chỉ khi có Redis
    ...(USE_REDIS ? [BullModule.registerQueue({ name: BUILD_QUEUE })] : []),
  ],
  controllers: [DeploymentsController, WakeController],
  providers: [
    DeploymentsService,
    BuildRunnerService,
    LogBroadcastService,
    HostStaticBuilder,
    DockerBackendEngine,
    HostBackendBuilder,
    HostRunReconcilerService,
    NotifyService,
    ReportService,
    MobileBuilder,
    CleanupService,
    SleepService,
    // Worker processor chỉ khởi tạo khi có Redis
    ...(USE_REDIS ? [BuildProcessor] : []),
  ],
  exports: [DeploymentsService, ReportService, NotifyService],
})
export class DeploymentsModule {}
