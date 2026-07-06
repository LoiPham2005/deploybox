import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import {
  changePasswordSchema,
  createTokenSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  toggle2faSchema,
  updateMeSchema,
  verifyLoginOtpSchema,
  verifyRegisterSchema,
  type ChangePasswordDto,
  type CreateTokenDto,
  type ForgotPasswordDto,
  type LoginDto,
  type RegisterDto,
  type ResetPasswordDto,
  type Toggle2faDto,
  type UpdateMeDto,
  type VerifyLoginOtpDto,
  type VerifyRegisterDto,
} from '@deploybox/shared';
import { AuthService, type LoginMeta } from './auth.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  JwtAuthGuard,
  type JwtPayload,
} from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionsService } from '../../infra/sessions/sessions.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';

/** Rút user-agent + IP thật (sau proxy) từ request — để ghi phiên đăng nhập. */
function loginMeta(req: Request): LoginMeta {
  const fwd = req.headers['x-forwarded-for'];
  return {
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    ip: (typeof fwd === 'string' ? fwd.split(',')[0].trim() : undefined) ?? req.ip,
  };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly jwtSvc: JwtService,
    private readonly flags: FeatureFlagsService,
  ) {}

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  register(
    @Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto,
    @Req() req: Request,
  ) {
    return this.auth.register(dto, loginMeta(req));
  }

  /** Đăng ký B1: gửi mã OTP về email (user chưa được tạo). */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register/request-otp')
  requestRegisterOtp(@Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto) {
    return this.auth.requestRegisterOtp(dto);
  }

  /** Đăng ký B2: nhập đúng OTP → tạo tài khoản + đăng nhập. */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register/verify')
  verifyRegister(
    @Body(new ZodValidationPipe(verifyRegisterSchema)) dto: VerifyRegisterDto,
    @Req() req: Request,
  ) {
    return this.auth.verifyRegister(dto, loginMeta(req));
  }

  /** Quên mật khẩu B1: gửi mã OTP về email (nếu tồn tại — luôn trả ok). */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('forgot-password')
  forgotPassword(@Body(new ZodValidationPipe(forgotPasswordSchema)) dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  /** Quên mật khẩu B2: OTP đúng → đặt mật khẩu mới. */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  resetPassword(@Body(new ZodValidationPipe(resetPasswordSchema)) dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginDto,
    @Req() req: Request,
  ) {
    return this.auth.login(dto, loginMeta(req));
  }

  /** 2FA bước 2: nhập OTP email sau khi login đúng mật khẩu. */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login/verify-otp')
  verifyLoginOtp(
    @Body(new ZodValidationPipe(verifyLoginOtpSchema)) dto: VerifyLoginOtpDto,
    @Req() req: Request,
  ) {
    return this.auth.verifyLoginOtp(dto, loginMeta(req));
  }

  /** Bật/tắt 2FA cho tài khoản của mình. */
  @UseGuards(JwtAuthGuard)
  @Post('me/2fa')
  set2fa(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(toggle2faSchema)) dto: Toggle2faDto,
  ) {
    return this.auth.set2fa(user.sub, dto.enabled);
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.clearCookie('db_token', { httpOnly: true, sameSite: 'lax', path: '/' });
    // Best-effort: thu hồi luôn phiên của token này (không bắt buộc token hợp lệ)
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      try {
        const payload = await this.jwtSvc.verifyAsync<JwtPayload>(auth.slice(7));
        if (payload.sid) await this.sessions.revoke(payload.sub, payload.sid);
      } catch {
        /* token hỏng/hết hạn — kệ, logout vẫn ok */
      }
    }
    return { ok: true };
  }

  // ── Phiên đăng nhập: xem thiết bị + đăng xuất từ xa ──

  private assertSessionsOn(): void {
    if (!this.flags.isEnabled('session_management')) {
      throw new BadRequestException(
        'Tính năng "Quản lý phiên đăng nhập" đang tắt (Admin → Tính năng hệ thống).',
      );
    }
  }

  /** Danh sách thiết bị đang đăng nhập tài khoản này. */
  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  listSessions(@CurrentUser() user: JwtPayload) {
    this.assertSessionsOn();
    return this.sessions.list(user.sub, user.sid);
  }

  /** Đăng xuất mọi thiết bị KHÁC (giữ phiên hiện tại). Khai báo TRƯỚC :id. */
  @UseGuards(JwtAuthGuard)
  @Delete('sessions/others')
  revokeOtherSessions(@CurrentUser() user: JwtPayload) {
    this.assertSessionsOn();
    return this.sessions.revokeOthers(user.sub, user.sid);
  }

  /** Đăng xuất 1 thiết bị (phiên của chính mình). */
  @UseGuards(JwtAuthGuard)
  @Delete('sessions/:id')
  revokeSession(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    this.assertSessionsOn();
    return this.sessions.revoke(user.sub, id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.auth.me(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateMe(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(updateMeSchema)) dto: UpdateMeDto,
  ) {
    return this.auth.updateMe(user.sub, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/password')
  changePassword(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(changePasswordSchema)) dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(user.sub, dto.currentPassword, dto.newPassword);
  }

  @UseGuards(JwtAuthGuard)
  @Get('tokens')
  listTokens(@CurrentUser() user: JwtPayload) {
    return this.auth.listTokens(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('tokens')
  createToken(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(createTokenSchema)) dto: CreateTokenDto,
  ) {
    return this.auth.createToken(user.sub, dto.name);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('tokens/:id')
  revokeToken(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.auth.revokeToken(user.sub, id);
  }
}
