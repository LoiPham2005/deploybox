import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isAdminRole, type EnvVarDto, type UpsertEnvDto } from '@deploybox/shared';
import type { TeamRole } from '../../generated/prisma';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';

const ROLE_ORDER: Record<TeamRole, number> = { MEMBER: 0, OWNER: 1 };

@Injectable()
export class EnvService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly flags: FeatureFlagsService,
  ) {}

  /** Admin hệ thống + flag env_reveal_secrets bật → cho xem giá trị secret thật. */
  private async canRevealSecrets(userId: string): Promise<boolean> {
    if (!this.flags.isEnabled('env_reveal_secrets')) return false;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return isAdminRole(user?.role);
  }

  private async loadOwnedProject(userId: string, projectId: string, minRole: TeamRole = 'MEMBER') {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Không tìm thấy project');
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: project.teamId, userId } },
    });
    if (!member) throw new ForbiddenException('Bạn không thuộc team này');
    if (ROLE_ORDER[member.role] < ROLE_ORDER[minRole]) {
      throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này');
    }
    return project;
  }

  async list(userId: string, projectId: string): Promise<EnvVarDto[]> {
    await this.loadOwnedProject(userId, projectId);
    const reveal = await this.canRevealSecrets(userId);
    const vars = await this.prisma.envVar.findMany({
      where: { projectId },
      orderBy: { key: 'asc' },
    });
    return vars.map((v) => ({
      key: v.key,
      // Mặc định KHÔNG trả secret plaintext; admin bật "hiện secret" thì giải mã cho xem.
      value: v.isSecret
        ? reveal
          ? this.safeDecrypt(v.value)
          : ''
        : v.value,
      isSecret: v.isSecret,
      target: v.target,
    }));
  }

  private safeDecrypt(enc: string): string {
    try {
      return this.crypto.decrypt(enc);
    } catch {
      return '';
    }
  }

  async upsert(
    userId: string,
    projectId: string,
    dto: UpsertEnvDto,
  ): Promise<EnvVarDto[]> {
    await this.loadOwnedProject(userId, projectId, 'OWNER');
    for (const v of dto.vars) {
      const value = v.isSecret ? this.crypto.encrypt(v.value) : v.value;
      await this.prisma.envVar.upsert({
        where: { projectId_key: { projectId, key: v.key } },
        update: { value, isSecret: v.isSecret, target: v.target },
        create: { projectId, key: v.key, value, isSecret: v.isSecret, target: v.target },
      });
    }
    // Thay thế toàn bộ: xoá mọi biến cũ KHÔNG có trong bộ vừa gửi.
    if (dto.replaceAll) {
      const keep = dto.vars.map((v) => v.key);
      await this.prisma.envVar.deleteMany({
        where: { projectId, key: { notIn: keep.length ? keep : ['__none__'] } },
      });
    }
    return this.list(userId, projectId);
  }

  async remove(userId: string, projectId: string, key: string): Promise<void> {
    await this.loadOwnedProject(userId, projectId, 'OWNER');
    await this.prisma.envVar.deleteMany({ where: { projectId, key } });
  }

  /** Dùng nội bộ bởi build/deploy (đã kiểm quyền ở tầng deploy). */
  async resolveForPhase(
    projectId: string,
    phase: 'build' | 'runtime',
  ): Promise<Record<string, string>> {
    const vars = await this.prisma.envVar.findMany({ where: { projectId } });
    const want = phase === 'build' ? ['BUILD', 'BOTH'] : ['RUNTIME', 'BOTH'];
    const out: Record<string, string> = {};
    for (const v of vars) {
      if (!want.includes(v.target)) continue;
      out[v.key] = v.isSecret ? this.crypto.decrypt(v.value) : v.value;
    }
    return out;
  }
}
