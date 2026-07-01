import { Global, Module } from '@nestjs/common';
import { AiService } from './ai.service';

/** AI "bác sĩ lỗi deploy" — global để BuildRunner/Deployments dùng chung. */
@Global()
@Module({
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
