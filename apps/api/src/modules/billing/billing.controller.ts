import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { BillingService } from './billing.service';
import { JwtAuthGuard, type JwtPayload } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @UseGuards(JwtAuthGuard)
  @Get('status/:teamId')
  status(@CurrentUser() u: JwtPayload, @Param('teamId') teamId: string) {
    return this.billing.status(u.sub, teamId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  checkout(
    @CurrentUser() u: JwtPayload,
    @Body() body: { teamId: string; months?: number; provider?: string },
  ) {
    return this.billing.checkout(
      u.sub,
      body.teamId,
      Number(body.months ?? 1),
      body.provider,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('order/:orderCode')
  order(@CurrentUser() u: JwtPayload, @Param('orderCode') orderCode: string) {
    return this.billing.getOrder(u.sub, orderCode);
  }

  @UseGuards(JwtAuthGuard)
  @Get('payments/:teamId')
  payments(@CurrentUser() u: JwtPayload, @Param('teamId') teamId: string) {
    return this.billing.history(u.sub, teamId);
  }

  // ─── PUBLIC — cổng thanh toán gọi về (tự xác thực trong provider) ─────────
  // SePay gửi POST (webhook). VNPay gửi GET (IPN có chữ ký trên query).
  @Post('webhook/:provider')
  @HttpCode(200)
  webhookPost(
    @Param('provider') provider: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return this.billing.handleCallback(provider, { headers, query, body });
  }

  @Get('webhook/:provider')
  @HttpCode(200)
  webhookGet(
    @Param('provider') provider: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: Record<string, unknown>,
  ) {
    return this.billing.handleCallback(provider, { headers, query, body: {} });
  }
}
