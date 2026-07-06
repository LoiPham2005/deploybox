import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { SessionsService } from '../../infra/sessions/sessions.service';

export interface JwtPayload {
  sub: string; // userId
  email: string;
  sid?: string; // id phiên đăng nhập — token cũ (trước bản session) không có
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Thiếu token');
    }
    const token = auth.slice('Bearer '.length);
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
    }
    // Phiên bị "Đăng xuất từ xa" → token chết dù chữ ký còn hạn.
    // (Token cũ không có sid → cho qua, tự hết hạn trong ≤7 ngày.)
    if (payload.sid && !(await this.sessions.isActive(payload.sid))) {
      throw new UnauthorizedException('Phiên đã bị đăng xuất — hãy đăng nhập lại');
    }
    (req as Request & { user: JwtPayload }).user = payload;
    return true;
  }
}
