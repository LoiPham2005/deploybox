import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        memberships: {
          where: { team: { isPersonal: true } },
          include: { team: { select: { id: true, plan: true } } },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async upgradePlan(teamId: string, plan: 'FREE' | 'PRO') {
    return this.prisma.team.update({ where: { id: teamId }, data: { plan } });
  }

  async stats() {
    const [users, teams, projects] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.team.count({ where: { isPersonal: true } }),
      this.prisma.project.count(),
    ]);
    return { users, teams, projects };
  }
}
