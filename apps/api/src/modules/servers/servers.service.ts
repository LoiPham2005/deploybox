import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Server, TeamRole } from '../../generated/prisma';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SshService } from '../../infra/ssh/ssh.service';
import { PLAN_LIMITS, isAdminRole } from '@deploybox/shared';
import type { ServerDto, CreateServerDto } from '@deploybox/shared';

const ROLE_ORDER: Record<TeamRole, number> = { MEMBER: 0, OWNER: 1 };

@Injectable()
export class ServersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly ssh: SshService,
    private readonly flags: FeatureFlagsService,
  ) {}

  private async assertRole(userId: string, teamId: string, min: TeamRole) {
    const m = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!m) throw new ForbiddenException('Bạn không thuộc team này');
    if (ROLE_ORDER[m.role] < ROLE_ORDER[min])
      throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này');
  }

  /** Admin hệ thống — bỏ qua mọi giới hạn gói. */
  private async isPlatformAdmin(userId: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return isAdminRole(u?.role);
  }

  async list(userId: string, teamId: string): Promise<ServerDto[]> {
    await this.assertRole(userId, teamId, 'MEMBER');
    const servers = await this.prisma.server.findMany({
      where: { teamId },
      orderBy: { createdAt: 'asc' },
    });
    return servers.map((s) => this.toDto(s));
  }

  async add(userId: string, teamId: string, dto: CreateServerDto): Promise<ServerDto> {
    await this.assertRole(userId, teamId, 'OWNER');

    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    // Admin hệ thống, hoặc admin đã TẮT giới hạn theo gói → không giới hạn
    const isAdmin = await this.isPlatformAdmin(userId);
    const noLimit = isAdmin || !this.flags.isEnabled('plan_limits_enabled');
    const limit = noLimit ? -1 : PLAN_LIMITS[team.plan as 'FREE' | 'PRO'].servers;
    if (limit !== -1) {
      const count = await this.prisma.server.count({ where: { teamId } });
      if (count >= limit) {
        throw new ForbiddenException(
          `Gói ${team.plan} chỉ cho thêm tối đa ${limit} server. Nâng cấp lên Pro để thêm.`,
        );
      }
    }

    const encryptedKey = dto.sshPrivateKey
      ? this.crypto.encrypt(dto.sshPrivateKey)
      : null;
    const server = await this.prisma.server.create({
      data: {
        teamId,
        name: dto.name,
        host: dto.host ?? 'localhost',
        port: dto.port ?? 22,
        username: dto.username ?? 'root',
        sshPrivateKey: encryptedKey,
        type: dto.type ?? 'LOCAL',
      },
    });
    return this.toDto(server);
  }

  async remove(userId: string, serverId: string): Promise<{ ok: true }> {
    const server = await this.prisma.server.findUnique({ where: { id: serverId } });
    if (!server) throw new NotFoundException('Không tìm thấy server');
    await this.assertRole(userId, server.teamId, 'OWNER');
    if (server.type === 'LOCAL')
      throw new ForbiddenException('Không thể xóa server local mặc định');
    await this.prisma.server.delete({ where: { id: serverId } });
    return { ok: true };
  }

  async testConnection(userId: string, serverId: string): Promise<{ ok: boolean; message: string }> {
    const server = await this.prisma.server.findUnique({ where: { id: serverId } });
    if (!server) throw new NotFoundException('Không tìm thấy server');
    await this.assertRole(userId, server.teamId, 'MEMBER');

    if (server.type === 'LOCAL') {
      await this.prisma.server.update({ where: { id: serverId }, data: { status: 'ONLINE' } });
      return { ok: true, message: 'Server local luôn online' };
    }

    const privateKey = server.sshPrivateKey
      ? this.crypto.decrypt(server.sshPrivateKey)
      : '';
    const ok = await this.ssh.testConnection({
      host: server.host,
      port: server.port,
      username: server.username,
      privateKey,
    });
    await this.prisma.server.update({
      where: { id: serverId },
      data: { status: ok ? 'ONLINE' : 'OFFLINE' },
    });
    return { ok, message: ok ? 'Kết nối SSH thành công' : 'Không kết nối được' };
  }

  /** Nội bộ: lấy server kèm private key đã decrypt (dùng bởi BuildRunnerService). */
  async getForBuild(serverId: string): Promise<Server & { decryptedKey: string | null }> {
    const server = await this.prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    const decryptedKey = server.sshPrivateKey
      ? this.crypto.decrypt(server.sshPrivateKey)
      : null;
    return { ...server, decryptedKey };
  }

  /** Lấy server LOCAL mặc định của team (tạo nếu chưa có). */
  async getOrCreateLocalServer(teamId: string): Promise<Server> {
    const existing = await this.prisma.server.findFirst({
      where: { teamId, type: 'LOCAL' },
    });
    if (existing) return existing;
    return this.prisma.server.create({
      data: { teamId, name: 'Local (mặc định)', type: 'LOCAL' },
    });
  }

  private toDto(s: Server): ServerDto {
    return {
      id: s.id,
      teamId: s.teamId,
      name: s.name,
      host: s.host,
      port: s.port,
      username: s.username,
      type: s.type as 'LOCAL' | 'REMOTE',
      status: s.status as 'UNKNOWN' | 'ONLINE' | 'OFFLINE',
      createdAt: s.createdAt.toISOString(),
    };
  }
}
