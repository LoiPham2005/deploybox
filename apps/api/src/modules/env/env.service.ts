import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EnvVarDto, UpsertEnvDto } from '@deploybox/shared';
import type { TeamRole } from '@prisma/client';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../infra/prisma/prisma.service';

const ROLE_ORDER: Record<TeamRole, number> = { MEMBER: 0, ADMIN: 1, OWNER: 2 };

@Injectable()
export class EnvService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

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
    const vars = await this.prisma.envVar.findMany({
      where: { projectId },
      orderBy: { key: 'asc' },
    });
    return vars.map((v) => ({
      key: v.key,
      value: v.isSecret ? '' : v.value, // không trả secret plaintext
      isSecret: v.isSecret,
      target: v.target,
    }));
  }

  async upsert(
    userId: string,
    projectId: string,
    dto: UpsertEnvDto,
  ): Promise<EnvVarDto[]> {
    await this.loadOwnedProject(userId, projectId, 'ADMIN');
    for (const v of dto.vars) {
      const value = v.isSecret ? this.crypto.encrypt(v.value) : v.value;
      await this.prisma.envVar.upsert({
        where: { projectId_key: { projectId, key: v.key } },
        update: { value, isSecret: v.isSecret, target: v.target },
        create: { projectId, key: v.key, value, isSecret: v.isSecret, target: v.target },
      });
    }
    return this.list(userId, projectId);
  }

  async remove(userId: string, projectId: string, key: string): Promise<void> {
    await this.loadOwnedProject(userId, projectId, 'ADMIN');
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
