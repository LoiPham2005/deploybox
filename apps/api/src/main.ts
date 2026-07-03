import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join, resolve } from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const config = app.get(ConfigService);

  // Đứng sau Caddy (cùng máy) → tin header X-Forwarded-For từ loopback
  // để req.ip là IP THẬT của client (rate-limit mới đếm đúng từng người).
  app.set('trust proxy', 'loopback');

  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: config.get<string>('CORS_ORIGIN', 'http://localhost:3000'),
    credentials: true,
  });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Phục vụ web tĩnh đã build: <DATA_DIR>/sites/<slug>/ -> /sites/<slug>/
  const dataDir = resolve(
    process.cwd(),
    config.get<string>('DATA_DIR', '.deploybox-data'),
  );
  app.useStaticAssets(join(dataDir, 'sites'), { prefix: '/sites' });
  // Phục vụ artifact mobile (APK/AAB): <DATA_DIR>/artifacts/<deploymentId>/ -> /artifacts/<deploymentId>/
  app.useStaticAssets(join(dataDir, 'artifacts'), { prefix: '/artifacts' });

  // Swagger UI (dev only — bỏ qua trong production nếu muốn)
  const swaggerDoc = new DocumentBuilder()
    .setTitle('DeployBox API')
    .setDescription('Self-hosted deployment platform API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerDoc);
  SwaggerModule.setup('api/docs', app, document);

  const port = config.get<number>('PORT', 4000);
  await app.listen(port);
  const log = new Logger('Bootstrap');
  log.log(`API: http://localhost:${port}/api/v1`);
  log.log(`Docs: http://localhost:${port}/api/docs`);
  log.log(`Static sites: http://localhost:${port}/sites/<slug>/`);
  log.log(`Artifacts:    http://localhost:${port}/artifacts/<deploymentId>/<file>`);
}

void bootstrap();
