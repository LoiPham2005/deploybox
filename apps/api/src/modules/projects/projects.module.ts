import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule], // dùng JwtAuthGuard + JwtModule
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService], // CLI module dùng listAccessible
})
export class ProjectsModule {}
