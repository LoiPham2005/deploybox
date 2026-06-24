import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { join, resolve } from 'path';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: config.get<string>('CORS_ORIGIN', 'http://localhost:3000'),
    credentials: true,
  });

  // Phục vụ web tĩnh đã build: <DATA_DIR>/sites/<slug>/ -> /sites/<slug>/
  const dataDir = resolve(
    process.cwd(),
    config.get<string>('DATA_DIR', '.deploybox-data'),
  );
  app.useStaticAssets(join(dataDir, 'sites'), { prefix: '/sites' });

  const port = config.get<number>('PORT', 4000);
  await app.listen(port);
  const log = new Logger('Bootstrap');
  log.log(`API: http://localhost:${port}/api/v1`);
  log.log(`Static sites: http://localhost:${port}/sites/<slug>/`);
}

void bootstrap();
