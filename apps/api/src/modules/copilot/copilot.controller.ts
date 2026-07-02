import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CopilotService, type CopilotMessage } from './copilot.service';
import {
  JwtAuthGuard,
  type JwtPayload,
} from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('copilot')
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  /** 1 lượt chat với Copilot (gửi kèm vài lượt trước để giữ mạch). */
  @Post('message')
  message(
    @CurrentUser() user: JwtPayload,
    @Body() body: { messages: CopilotMessage[] },
  ) {
    const messages = Array.isArray(body.messages) ? body.messages.slice(-10) : [];
    return this.copilot.message(user.sub, messages);
  }

  /** User bấm nút xác nhận hành động AI đề xuất. */
  @Post('action')
  action(
    @CurrentUser() user: JwtPayload,
    @Body() body: { projectId: string; action: 'deploy' | 'stop' },
  ) {
    return this.copilot.executeAction(
      user.sub,
      String(body.projectId ?? ''),
      body.action === 'stop' ? 'stop' : 'deploy',
    );
  }
}
