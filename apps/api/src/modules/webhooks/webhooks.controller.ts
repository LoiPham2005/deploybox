import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { JwtAuthGuard, type JwtPayload } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller()
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  // Public — được gọi bởi GitHub/GitLab, xác thực bằng secret.
  @Post('webhooks/git/:projectId')
  @HttpCode(200)
  handle(
    @Param('projectId') projectId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
  ) {
    return this.webhooks.handlePush(
      projectId,
      headers,
      req.rawBody ?? Buffer.from(''),
      body,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('projects/:projectId/webhook-events')
  listEvents(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
  ) {
    return this.webhooks.listEvents(user.sub, projectId);
  }
}
