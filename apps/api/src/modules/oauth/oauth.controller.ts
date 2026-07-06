import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { OauthService } from './oauth.service';
import { JwtAuthGuard, type JwtPayload } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { LoginMeta } from '../auth/auth.service';

function meta(req: Request): LoginMeta {
  const fwd = req.headers['x-forwarded-for'];
  return {
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    ip: (typeof fwd === 'string' ? fwd.split(',')[0].trim() : undefined) ?? req.ip,
  };
}

@Controller('auth/oauth')
export class OauthController {
  constructor(private readonly oauth: OauthService) {}

  /** Web hỏi: nhà nào sẵn sàng để hiện nút. Public. */
  @Get('providers')
  providers() {
    return this.oauth.providerStatuses();
  }

  /** Bắt đầu LOGIN: browser mở thẳng link này → 302 sang provider. */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get(':provider/start')
  start(@Param('provider') provider: string, @Res() res: Response) {
    try {
      res.redirect(this.oauth.startLogin(provider));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'OAuth lỗi';
      res.redirect(`${this.oauth.webUrl()}/login?oauth_error=${encodeURIComponent(msg)}`);
    }
  }

  /** Bắt đầu CONNECT (cần JWT — web server gọi hộ rồi redirect browser). */
  @UseGuards(JwtAuthGuard)
  @Post(':provider/start-connect')
  startConnect(@CurrentUser() user: JwtPayload, @Param('provider') provider: string) {
    return { url: this.oauth.startConnect(provider, user.sub) };
  }

  /** Provider gọi về sau khi user đồng ý. Public. */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const web = this.oauth.webUrl();
    if (!code || !state) {
      return res.redirect(`${web}/login?oauth_error=${encodeURIComponent('Thiếu code/state')}`);
    }
    const r = await this.oauth.handleCallback(provider, code, state, meta(req));
    switch (r.kind) {
      case 'login':
        return res.redirect(`${web}/api/oauth/landing?code=${encodeURIComponent(r.exchangeCode)}`);
      case 'connected':
        return res.redirect(`${web}/account?connected=${encodeURIComponent(provider)}`);
      case 'pending_signup':
        return res.redirect(
          `${web}/register?oauth_pending=${encodeURIComponent(r.pendingId)}` +
            `&login=${encodeURIComponent(r.login)}&email=${encodeURIComponent(r.email)}`,
        );
      case 'error':
        return res.redirect(`${web}/login?oauth_error=${encodeURIComponent(r.message)}`);
    }
  }

  /** Hoàn tất đăng ký OAuth khi cần mã mời (web server action gọi). */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('complete-signup')
  completeSignup(
    @Body() body: { pendingId?: string; signupCode?: string },
    @Req() req: Request,
  ) {
    return this.oauth.completeSignup(body.pendingId ?? '', body.signupCode ?? '', meta(req));
  }

  /** Đổi one-time code lấy JWT (web landing route gọi). */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('exchange')
  exchange(@Body() body: { code?: string }) {
    return this.oauth.exchange(body.code ?? '');
  }

  /** Danh tính đã kết nối của tôi. */
  @UseGuards(JwtAuthGuard)
  @Get('identities')
  identities(@CurrentUser() user: JwtPayload) {
    return this.oauth.listIdentities(user.sub);
  }

  /** Gỡ liên kết 1 nhà. */
  @UseGuards(JwtAuthGuard)
  @Delete('identities/:provider')
  unlink(@CurrentUser() user: JwtPayload, @Param('provider') provider: string) {
    return this.oauth.unlink(user.sub, provider);
  }

  /** Repos của tôi qua danh tính đã kết nối (picker tạo project). */
  @UseGuards(JwtAuthGuard)
  @Get(':provider/repos')
  repos(@CurrentUser() user: JwtPayload, @Param('provider') provider: string) {
    return this.oauth.listRepos(user.sub, provider);
  }

  /** Tự tạo webhook cho project vừa tạo từ repo picker. */
  @UseGuards(JwtAuthGuard)
  @Post(':provider/setup-webhook')
  setupWebhook(
    @CurrentUser() user: JwtPayload,
    @Param('provider') provider: string,
    @Body() body: { projectId?: string },
  ) {
    return this.oauth.setupWebhook(user.sub, provider, body.projectId ?? '');
  }
}
