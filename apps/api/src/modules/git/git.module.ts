import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GitController } from './git.controller';
import { GitService } from './git.service';

@Module({
  imports: [AuthModule],
  controllers: [GitController],
  providers: [GitService],
})
export class GitModule {}
