import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type { Request } from 'express';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { JwtPayload } from './jwt-auth.guard';

@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer deploybox_')) {
      throw new UnauthorizedException('Thiếu API token');
    }
    const raw = auth.slice('Bearer '.length);
    const hash = createHash('sha256').update(raw).digest('hex');

    const token = await this.prisma.apiToken.findUnique({
      where: { tokenHash: hash },
      include: { user: true },
    });
    if (!token) throw new UnauthorizedException('API token không hợp lệ');

    // cập nhật lastUsedAt không chặn response
    void this.prisma.apiToken.update({
      where: { id: token.id },
      data: { lastUsedAt: new Date() },
    });

    const payload: JwtPayload = { sub: token.userId, email: token.user.email };
    (req as Request & { user: JwtPayload }).user = payload;
    return true;
  }
}
