import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeploymentsModule } from '../deployments/deployments.module';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';

@Module({
  imports: [AuthModule, DeploymentsModule],
  controllers: [CopilotController],
  providers: [CopilotService],
})
export class CopilotModule {}
