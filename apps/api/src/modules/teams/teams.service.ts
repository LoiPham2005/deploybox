import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PLAN_LIMITS, isAdminRole } from '@deploybox/shared';
import type { TeamMemberDto } from '@deploybox/shared';
import type { TeamRole } from '../../generated/prisma';
import { PrismaService } from '../../infra/prisma/prisma.service';

const ROLE_ORDER: Record<TeamRole, number> = { MEMBER: 0, OWNER: 1 };

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

  /** Admin hệ thống — bỏ qua mọi giới hạn gói. */
  private async isPlatformAdmin(userId: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return isAdminRole(u?.role);
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
    role: 'MEMBER',
  ): Promise<TeamMemberDto> {
    await this.assertRole(actorId, teamId, 'OWNER');

    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    // Admin hệ thống: mời thoải mái, không cần PRO, không giới hạn
    const isAdmin = await this.isPlatformAdmin(actorId);
    if (!isAdmin && team.plan !== 'PRO') {
      throw new ForbiddenException('Chỉ gói PRO mới được mời thành viên. Nâng cấp để mời.');
    }

    const limit = isAdmin ? -1 : PLAN_LIMITS['PRO'].members;
    if (limit !== -1) {
      const count = await this.prisma.teamMember.count({ where: { teamId } });
      if (count >= limit) {
        throw new ForbiddenException(
          `Gói PRO chỉ cho tối đa ${limit} thành viên.`,
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
    role: 'MEMBER',
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
    await this.assertRole(actorId, teamId, 'OWNER');

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

    // Dọn luôn quyền project của member này trong team
    await this.prisma.projectMember.deleteMany({
      where: { userId: member.userId, project: { teamId } },
    });
    await this.prisma.teamMember.delete({ where: { id: memberId } });
    return { ok: true };
  }

  /**
   * Ma trận quyền project: danh sách project của team + mỗi member được cấp project nào.
   * Chỉ OWNER xem/sửa được.
   */
  async listProjectAccess(
    actorId: string,
    teamId: string,
  ): Promise<{
    projects: { id: string; name: string }[];
    access: Record<string, string[]>;
  }> {
    await this.assertRole(actorId, teamId, 'OWNER');
    const projects = await this.prisma.project.findMany({
      where: { teamId },
      select: { id: true, name: true },
      orderBy: { createdAt: 'desc' },
    });
    const grants = await this.prisma.projectMember.findMany({
      where: { project: { teamId } },
      select: { projectId: true, userId: true },
    });
    const access: Record<string, string[]> = {};
    for (const g of grants) {
      (access[g.userId] ??= []).push(g.projectId);
    }
    return { projects, access };
  }

  /** Đặt lại danh sách project mà 1 member được xem (thay thế toàn bộ). */
  async setMemberProjects(
    actorId: string,
    teamId: string,
    memberUserId: string,
    projectIds: string[],
  ): Promise<{ ok: true }> {
    await this.assertRole(actorId, teamId, 'OWNER');
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: memberUserId } },
    });
    if (!member) throw new NotFoundException('Thành viên không thuộc team này');
    // Chỉ nhận project thuộc đúng team
    const valid = await this.prisma.project.findMany({
      where: { teamId, id: { in: projectIds } },
      select: { id: true },
    });
    await this.prisma.$transaction([
      this.prisma.projectMember.deleteMany({
        where: { userId: memberUserId, project: { teamId } },
      }),
      ...valid.map((p) =>
        this.prisma.projectMember.create({
          data: { projectId: p.id, userId: memberUserId },
        }),
      ),
    ]);
    return { ok: true };
  }
}
