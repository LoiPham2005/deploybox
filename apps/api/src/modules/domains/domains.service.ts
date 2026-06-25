import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AddDomainDto,
  AddDomainResponse,
  ProjectDomainDto,
} from '@deploybox/shared';
import type { Domain, TeamRole } from '@prisma/client';
import { randomBytes } from 'crypto';
import { resolveTxt } from 'dns/promises';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CaddyService } from '../../infra/caddy/caddy.service';

@Injectable()
export class DomainsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly caddy: CaddyService,
    private readonly config: ConfigService,
  ) {}

  private static readonly ROLE_ORDER: Record<TeamRole, number> = { MEMBER: 0, ADMIN: 1, OWNER: 2 };

  private async assertRole(userId: string, teamId: string, min: TeamRole): Promise<void> {
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member) throw new ForbiddenException('Bạn không thuộc team này');
    if (DomainsService.ROLE_ORDER[member.role] < DomainsService.ROLE_ORDER[min]) {
      throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này');
    }
  }

  private async loadOwnedProject(userId: string, projectId: string, min: TeamRole = 'MEMBER') {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Không tìm thấy project');
    await this.assertRole(userId, project.teamId, min);
    return project;
  }

  private async loadOwnedDomain(userId: string, domainId: string, min: TeamRole = 'MEMBER') {
    const domain = await this.prisma.domain.findUnique({
      where: { id: domainId },
      include: { project: true },
    });
    if (!domain) throw new NotFoundException('Không tìm thấy domain');
    await this.assertRole(userId, domain.project.teamId, min);
    return domain;
  }

  async list(userId: string, projectId: string): Promise<ProjectDomainDto[]> {
    await this.loadOwnedProject(userId, projectId);
    const domains = await this.prisma.domain.findMany({
      where: { projectId },
      orderBy: { isPrimary: 'desc' },
    });
    return domains.map((d) => this.toDto(d));
  }

  async add(
    userId: string,
    projectId: string,
    dto: AddDomainDto,
  ): Promise<AddDomainResponse> {
    const project = await this.loadOwnedProject(userId, projectId, 'ADMIN');
    const existing = await this.prisma.domain.findUnique({
      where: { hostname: dto.hostname },
    });
    if (existing) throw new ConflictException('Domain đã được sử dụng');

    const verifyToken = randomBytes(16).toString('hex');
    const domain = await this.prisma.domain.create({
      data: {
        projectId,
        hostname: dto.hostname,
        isManaged: false,
        status: 'PENDING_DNS',
        verifyToken,
      },
    });
    // route ngay (nội bộ tin cậy); verify TXT để xác nhận sở hữu khi cần
    await this.caddy.sync().catch(() => undefined);

    const appDomain = this.config.get<string>('APP_DOMAIN', 'localhost');
    return {
      domain: {
        id: domain.id,
        hostname: domain.hostname,
        status: domain.status,
      },
      dnsInstructions: {
        type: 'CNAME',
        name: dto.hostname,
        value: `${project.slug}.${appDomain}`,
      },
      verification: {
        type: 'TXT',
        name: `_deploybox.${dto.hostname}`,
        value: verifyToken,
      },
    };
  }

  async verify(userId: string, domainId: string): Promise<ProjectDomainDto> {
    const domain = await this.loadOwnedDomain(userId, domainId, 'ADMIN');
    let status: 'ACTIVE' | 'FAILED' = 'FAILED';
    try {
      const records = await resolveTxt(`_deploybox.${domain.hostname}`);
      if (records.flat().includes(domain.verifyToken ?? '__none__')) {
        status = 'ACTIVE';
      }
    } catch {
      status = 'FAILED';
    }
    const updated = await this.prisma.domain.update({
      where: { id: domainId },
      data: { status },
    });
    if (status === 'ACTIVE') await this.caddy.sync().catch(() => undefined);
    return this.toDto(updated);
  }

  async remove(userId: string, domainId: string): Promise<{ ok: true }> {
    const domain = await this.loadOwnedDomain(userId, domainId, 'ADMIN');
    if (domain.isPrimary) {
      throw new BadRequestException('Không thể xóa domain chính');
    }
    await this.prisma.domain.delete({ where: { id: domainId } });
    await this.caddy.sync().catch(() => undefined);
    return { ok: true };
  }

  async setPrimary(userId: string, domainId: string): Promise<ProjectDomainDto> {
    const domain = await this.loadOwnedDomain(userId, domainId, 'ADMIN');
    // unset current primary
    await this.prisma.domain.updateMany({
      where: { projectId: domain.projectId, isPrimary: true },
      data: { isPrimary: false },
    });
    const updated = await this.prisma.domain.update({
      where: { id: domainId },
      data: { isPrimary: true },
    });
    await this.caddy.sync().catch(() => undefined);
    return this.toDto(updated);
  }

  private toDto(d: Domain): ProjectDomainDto {
    return {
      id: d.id,
      hostname: d.hostname,
      isPrimary: d.isPrimary,
      status: d.status,
    };
  }
}
