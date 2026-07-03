import { Body, Controller, Delete, Get, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  changePasswordSchema,
  createTokenSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateMeSchema,
  verifyRegisterSchema,
  type ChangePasswordDto,
  type CreateTokenDto,
  type ForgotPasswordDto,
  type LoginDto,
  type RegisterDto,
  type ResetPasswordDto,
  type UpdateMeDto,
  type VerifyRegisterDto,
} from '@deploybox/shared';
import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  JwtAuthGuard,
  type JwtPayload,
} from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  register(@Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto) {
    return this.auth.register(dto);
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
  verifyRegister(@Body(new ZodValidationPipe(verifyRegisterSchema)) dto: VerifyRegisterDto) {
    return this.auth.verifyRegister(dto);
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
  login(@Body(new ZodValidationPipe(loginSchema)) dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('db_token', { httpOnly: true, sameSite: 'lax', path: '/' });
    return { ok: true };
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
