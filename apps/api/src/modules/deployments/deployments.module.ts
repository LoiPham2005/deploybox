import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DeploymentsController } from './deployments.controller';
import { DeploymentsService } from './deployments.service';
import { BuildProcessor } from './build.processor';
import { HostStaticBuilder } from '../../infra/builder/host-static.builder';
import { DockerBackendEngine } from '../../infra/builder/docker-backend.engine';
import { CleanupService } from '../../infra/cleanup/cleanup.service';
import { AuthModule } from '../auth/auth.module';
import { EnvModule } from '../env/env.module';
import { CaddyModule } from '../../infra/caddy/caddy.module';
import { BUILD_QUEUE } from './queue.constants';

@Module({
  imports: [
    AuthModule,
    EnvModule,
    CaddyModule,
    BullModule.registerQueue({ name: BUILD_QUEUE }),
  ],
  controllers: [DeploymentsController],
  providers: [
    DeploymentsService,
    BuildProcessor,
    HostStaticBuilder,
    DockerBackendEngine,
    CleanupService,
  ],
  exports: [DeploymentsService],
})
export class DeploymentsModule {}
