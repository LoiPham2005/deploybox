import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import type { Request } from 'express';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { JwtPayload } from './jwt-auth.guard';

/**
 * Nhận CẢ HAI kiểu xác thực:
 * - JWT (web app, sau khi đăng nhập)
 * - API token `deploybox_…` (deploy từ CI/CD như GitHub Actions, không cần mật khẩu)
 * Token mang đúng quyền của user sở hữu nó → vẫn theo quyền project bình thường.
 */
@Injectable()
export class JwtOrApiTokenGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Thiếu token');
    }
    const raw = auth.slice('Bearer '.length);

    // ----- API token (CI/CD) -----
    if (raw.startsWith('deploybox_')) {
      const hash = createHash('sha256').update(raw).digest('hex');
      const token = await this.prisma.apiToken.findUnique({
        where: { tokenHash: hash },
        include: { user: true },
      });
      if (!token) throw new UnauthorizedException('API token không hợp lệ');
      // cập nhật lastUsedAt, không chặn response
      void this.prisma.apiToken.update({
        where: { id: token.id },
        data: { lastUsedAt: new Date() },
      });
      (req as Request & { user: JwtPayload }).user = {
        sub: token.userId,
        email: token.user.email,
      };
      return true;
    }

    // ----- JWT (web app) -----
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(raw);
      (req as Request & { user: JwtPayload }).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn');
    }
  }
}
