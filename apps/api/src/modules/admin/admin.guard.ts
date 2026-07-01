import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { isAdminRole } from '@deploybox/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.sub;
    if (!userId) throw new ForbiddenException();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!isAdminRole(user?.role)) throw new ForbiddenException('Chỉ admin hệ thống mới truy cập được');
    return true;
  }
}
