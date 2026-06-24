import { Module } from '@nestjs/common';
import { DomainsController } from './domains.controller';
import { DomainsService } from './domains.service';
import { AuthModule } from '../auth/auth.module';
import { CaddyModule } from '../../infra/caddy/caddy.module';

@Module({
  imports: [AuthModule, CaddyModule],
  controllers: [DomainsController],
  providers: [DomainsService],
})
export class DomainsModule {}
