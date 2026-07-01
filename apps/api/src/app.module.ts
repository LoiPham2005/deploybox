import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { validateEnv } from './config/config.schema';
import { CryptoModule } from './common/crypto/crypto.module';
import { MetricsModule } from './infra/metrics/metrics.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { FeatureFlagsModule } from './infra/feature-flags/feature-flags.module';
import { AiModule } from './infra/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { EnvModule } from './modules/env/env.module';
import { DeploymentsModule } from './modules/deployments/deployments.module';
import { DomainsModule } from './modules/domains/domains.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { TeamsModule } from './modules/teams/teams.module';
import { ServersModule } from './modules/servers/servers.module';
import { SshModule } from './infra/ssh/ssh.module';
import { GitModule } from './modules/git/git.module';
import { AdminModule } from './modules/admin/admin.module';
import { TelegramModule } from './modules/telegram/telegram.module';

// Đọc sớm để quyết định có import BullModule không (trước khi NestJS bootstrap)
const REDIS_URL = process.env.REDIS_URL ?? '';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      validate: validateEnv,
    }),
    // BullMQ chỉ khởi tạo khi có Redis
    ...(REDIS_URL
      ? [
          BullModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => {
              const url = new URL(config.get<string>('REDIS_URL', ''));
              return {
                connection: { host: url.hostname, port: Number(url.port) || 6379 },
              };
            },
          }),
        ]
      : []),
    PrismaModule,
    FeatureFlagsModule,
    AiModule,
    CryptoModule,
    MetricsModule,
    AuthModule,
    HealthModule,
    ProjectsModule,
    EnvModule,
    DeploymentsModule,
    DomainsModule,
    WebhooksModule,
    TeamsModule,
    SshModule,
    ServersModule,
    GitModule,
    AdminModule,
    TelegramModule,
  ],
})
export class AppModule {}
