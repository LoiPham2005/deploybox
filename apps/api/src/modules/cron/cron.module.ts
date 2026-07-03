import { Module } from '@nestjs/common';
import { CronController } from './cron.controller';
import { CronService } from './cron.service';
import { AuthModule } from '../auth/auth.module'; // JwtAuthGuard
import { EnvModule } from '../env/env.module'; // EnvService (env runtime cho host-run)

@Module({
  imports: [AuthModule, EnvModule],
  controllers: [CronController],
  providers: [CronService],
})
export class CronModule {}
