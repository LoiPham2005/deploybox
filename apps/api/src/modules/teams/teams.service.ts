import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PLAN_LIMITS } from '@deploybox/shared';
import type { TeamMemberDto } from '@deploybox/shared';
import type { TeamRole } from '../../generated/prisma';
import { PrismaService } from '../../infra/prisma/prisma.service';

const ROLE_ORDER: Record<TeamRole, number> = { MEMBER: 0, ADMIN: 1, OWNER: 2 };

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertRole(
    userId: string,
    teamId: string,
    min: TeamRole,
  ): Promise<void> {
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member) throw new ForbiddenException('Bạn không thuộc team này');
    if (ROLE_ORDER[member.role] < ROLE_ORDER[min]) {
      throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này');
    }
  }

  async listMembers(userId: string, teamId: string): Promise<TeamMemberDto[]> {
    await this.assertRole(userId, teamId, 'MEMBER');
    const members = await this.prisma.teamMember.findMany({
      where: { teamId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      id: m.id,
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      joinedAt: m.createdAt.toISOString(),
    }));
  }

  async invite(
    actorId: string,
    teamId: string,
    email: string,
    role: 'ADMIN' | 'MEMBER',
  ): Promise<TeamMemberDto> {
    await this.assertRole(actorId, teamId, 'ADMIN');

    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    const limit = PLAN_LIMITS[team.plan as 'FREE' | 'PRO'].members;
    if (limit !== -1) {
      const count = await this.prisma.teamMember.count({ where: { teamId } });
      if (count >= limit) {
        throw new ForbiddenException(
          `Gói ${team.plan} chỉ cho tối đa ${limit} thành viên. Nâng cấp lên Pro để mời thêm.`,
        );
      }
    }

    const target = await this.prisma.user.findUnique({ where: { email } });
    if (!target) throw new NotFoundException('Không tìm thấy người dùng với email này');

    const existing = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: target.id } },
    });
    if (existing) throw new ConflictException('Người dùng đã là thành viên của team');

    const member = await this.prisma.teamMember.create({
      data: { teamId, userId: target.id, role },
      include: { user: true },
    });
    return {
      id: member.id,
      userId: member.userId,
      email: member.user.email,
      name: member.user.name,
      role: member.role,
      joinedAt: member.createdAt.toISOString(),
    };
  }

  async updateRole(
    actorId: string,
    teamId: string,
    memberId: string,
    role: 'ADMIN' | 'MEMBER',
  ): Promise<TeamMemberDto> {
    await this.assertRole(actorId, teamId, 'OWNER');

    const member = await this.prisma.teamMember.findUnique({
      where: { id: memberId },
      include: { user: true },
    });
    if (!member || member.teamId !== teamId) {
      throw new NotFoundException('Không tìm thấy thành viên');
    }
    if (member.role === 'OWNER') {
      throw new ForbiddenException('Không thể thay đổi role của OWNER');
    }

    const updated = await this.prisma.teamMember.update({
      where: { id: memberId },
      data: { role },
      include: { user: true },
    });
    return {
      id: updated.id,
      userId: updated.userId,
      email: updated.user.email,
      name: updated.user.name,
      role: updated.role,
      joinedAt: updated.createdAt.toISOString(),
    };
  }

  async removeMember(
    actorId: string,
    teamId: string,
    memberId: string,
  ): Promise<{ ok: true }> {
    await this.assertRole(actorId, teamId, 'ADMIN');

    const member = await this.prisma.teamMember.findUnique({
      where: { id: memberId },
    });
    if (!member || member.teamId !== teamId) {
      throw new NotFoundException('Không tìm thấy thành viên');
    }
    if (member.role === 'OWNER') {
      throw new ForbiddenException('Không thể xoá OWNER khỏi team');
    }
    if (member.userId === actorId) {
      throw new ForbiddenException('Không thể tự xoá mình khỏi team');
    }

    await this.prisma.teamMember.delete({ where: { id: memberId } });
    return { ok: true };
  }
}
