import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';

// Public (không JwtAuthGuard) — được gọi bởi GitHub/GitLab, xác thực bằng secret.
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('git/:projectId')
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
}
