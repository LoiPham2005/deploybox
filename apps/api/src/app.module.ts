import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { validateEnv } from './config/config.schema';
import { CryptoModule } from './common/crypto/crypto.module';
import { MetricsModule } from './infra/metrics/metrics.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { EnvModule } from './modules/env/env.module';
import { DeploymentsModule } from './modules/deployments/deployments.module';
import { DomainsModule } from './modules/domains/domains.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';

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
    CryptoModule,
    MetricsModule,
    AuthModule,
    HealthModule,
    ProjectsModule,
    EnvModule,
    DeploymentsModule,
    DomainsModule,
    WebhooksModule,
  ],
})
export class AppModule {}
