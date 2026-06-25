import { Body, Controller, Delete, Get, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  changePasswordSchema,
  createTokenSchema,
  loginSchema,
  registerSchema,
  updateMeSchema,
  type ChangePasswordDto,
  type CreateTokenDto,
  type LoginDto,
  type RegisterDto,
  type UpdateMeDto,
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

  @Post('register')
  register(@Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto) {
    return this.auth.register(dto);
  }

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
