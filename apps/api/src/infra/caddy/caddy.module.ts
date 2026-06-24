import { Module } from '@nestjs/common';
import { CaddyService } from './caddy.service';
import { DockerService } from '../docker/docker.service';

@Module({
  providers: [CaddyService, DockerService],
  exports: [CaddyService, DockerService],
})
export class CaddyModule {}
