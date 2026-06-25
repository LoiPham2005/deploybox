import { Global, Module } from '@nestjs/common';
import { SshService } from './ssh.service';

@Global()
@Module({
  providers: [SshService],
  exports: [SshService],
})
export class SshModule {}
