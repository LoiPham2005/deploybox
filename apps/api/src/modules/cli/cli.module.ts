import { Module } from '@nestjs/common';
import { CliController } from './cli.controller';
import { AuthModule } from '../auth/auth.module'; // JwtOrApiTokenGuard cần JwtService
import { ProjectsModule } from '../projects/projects.module'; // ProjectsService

@Module({
  imports: [AuthModule, ProjectsModule],
  controllers: [CliController],
})
export class CliModule {}
