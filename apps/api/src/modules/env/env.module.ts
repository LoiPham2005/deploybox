import { Module } from '@nestjs/common';
import { EnvController } from './env.controller';
import { EnvService } from './env.service';
import { SecretFileController } from './secret-file.controller';
import { SecretFileService } from './secret-file.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [EnvController, SecretFileController],
  providers: [EnvService, SecretFileService],
  exports: [EnvService, SecretFileService],
})
export class EnvModule {}
