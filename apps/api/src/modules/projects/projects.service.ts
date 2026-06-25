import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PLAN_LIMITS } from '@deploybox/shared';
import { ConfigService } from '@nestjs/config';
import type { Deployment, Domain, Project, TeamRole } from '../../generated/prisma';
import type {
  CreateProjectDto,
  Paginated,
  ProjectDetailDto,
  ProjectSummary,
  UpdateProjectDto,
} from '@deploybox/shared';
import { randomBytes } from 'crypto';
import { rm } from 'fs/promises';
import { join, resolve } from 'path';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'project'
  );
}

type ProjectWithRels = Project & {
  domains?: Domain[];
  deployments?: Deployment[];
};

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
  ) {}

  // ----- truy cập theo team (nền tảng cô lập tenant) -----

  private static readonly ROLE_ORDER: Record<TeamRole, number> = {
    MEMBER: 0,
    ADMIN: 1,
    OWNER: 2,
  };

  async assertRole(userId: string, teamId: string, min: TeamRole): Promise<void> {
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member) throw new ForbiddenException('Bạn không thuộc team này');
    if (ProjectsService.ROLE_ORDER[member.role] < ProjectsService.ROLE_ORDER[min]) {
      throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này');
    }
  }

  private async assertMembership(userId: string, teamId: string): Promise<void> {
    await this.assertRole(userId, teamId, 'MEMBER');
  }

  private async loadOwnedProject(
    userId: string,
    projectId: string,
    minRole: TeamRole = 'MEMBER',
  ): Promise<Project> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException('Không tìm thấy project');
    }
    await this.assertRole(userId, project.teamId, minRole);
    return project;
  }

  // ----- CRUD -----

  async list(
    userId: string,
    teamId: string,
  ): Promise<Paginated<ProjectSummary>> {
    await this.assertMembership(userId, teamId);
    const projects = await this.prisma.project.findMany({
      where: { teamId },
      orderBy: { createdAt: 'desc' },
      include: {
        domains: { where: { isPrimary: true }, take: 1 },
        deployments: { orderBy: { queuedAt: 'desc' }, take: 1 },
      },
    });
    const data = projects.map((p) => this.toSummary(p));
    return { data, total: data.length, page: 1, pageSize: data.length };
  }

  async create(
    userId: string,
    teamId: string,
    dto: CreateProjectDto,
  ): Promise<ProjectSummary> {
    await this.assertRole(userId, teamId, 'ADMIN');

    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    const limit = PLAN_LIMITS[team.plan as 'FREE' | 'PRO'].projects;
    if (limit !== -1) {
      const count = await this.prisma.project.count({ where: { teamId } });
      if (count >= limit) {
        throw new ForbiddenException(
          `Gói ${team.plan} chỉ cho tạo tối đa ${limit} project. Nâng cấp lên Pro để tạo thêm.`,
        );
      }
    }

    const slug = await this.uniqueSlug(teamId, dto.name);
    const appDomain = this.config.get<string>('APP_DOMAIN', 'deploybox.local');

    const project = await this.prisma.project.create({
      data: {
        teamId,
        name: dto.name,
        slug,
        type: dto.type,
        gitRepoUrl: dto.gitRepoUrl,
        gitBranch: dto.gitBranch ?? 'main',
        rootDir: dto.rootDir ?? '.',
        gitToken: dto.gitToken ? this.crypto.encrypt(dto.gitToken) : null,
        buildCommand: dto.buildCommand,
        startCommand: dto.startCommand,
        outputDir: dto.outputDir,
        internalPort: dto.internalPort ?? 3000,
        notifyUrl: dto.notifyUrl || null,
        serverId: dto.serverId || null,
        webhookSecret: randomBytes(16).toString('hex'),
        // mỗi project có sẵn một subdomain managed mặc định
        domains: {
          create: {
            hostname: `${slug}.${appDomain}`,
            isManaged: true,
            isPrimary: true,
            status: 'PENDING_DNS',
          },
        },
      },
      include: {
        domains: { where: { isPrimary: true }, take: 1 },
        deployments: { take: 1 },
      },
    });
    return this.toSummary(project);
  }

  async get(userId: string, projectId: string): Promise<ProjectDetailDto> {
    await this.loadOwnedProject(userId, projectId);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        domains: { orderBy: { isPrimary: 'desc' } },
        deployments: { orderBy: { queuedAt: 'desc' }, take: 30 },
      },
    });
    return this.toDetail(project);
  }

  async update(
    userId: string,
    projectId: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectDetailDto> {
    await this.loadOwnedProject(userId, projectId, 'ADMIN');
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...dto,
        // chuỗi rỗng từ form -> null
        gitRepoUrl: dto.gitRepoUrl === '' ? null : dto.gitRepoUrl,
        buildImage: dto.buildImage === '' ? null : dto.buildImage,
        artifactPath: dto.artifactPath === '' ? null : dto.artifactPath,
        // gitToken: rỗng = xóa token; có giá trị = encrypt lại
        gitToken: dto.gitToken === undefined
          ? undefined                                       // không thay đổi
          : dto.gitToken === ''
            ? null                                         // xóa
            : this.crypto.encrypt(dto.gitToken),           // cập nhật
        notifyUrl: dto.notifyUrl === undefined
          ? undefined
          : dto.notifyUrl === '' ? null : dto.notifyUrl,
      },
    });
    return this.get(userId, projectId);
  }

  async remove(
    userId: string,
    projectId: string,
  ): Promise<{ ok: true }> {
    const project = await this.loadOwnedProject(userId, projectId, 'OWNER');

    // Lấy tất cả deployment IDs để xóa artifact + log files
    const deployments = await this.prisma.deployment.findMany({
      where: { projectId },
      select: { id: true },
    });

    await this.prisma.project.delete({ where: { id: projectId } });

    // Xóa file artifacts và logs sau khi xóa DB (không chặn nếu lỗi)
    const dataDir = resolve(
      process.cwd(),
      this.config.get<string>('DATA_DIR', '.deploybox-data'),
    );
    for (const { id } of deployments) {
      await rm(join(dataDir, 'artifacts', id), { recursive: true, force: true }).catch(() => undefined);
      await rm(join(dataDir, 'logs', `${id}.log`), { force: true }).catch(() => undefined);
    }
    // Xóa thư mục site (STATIC project)
    if (project.type === 'STATIC') {
      await rm(join(dataDir, 'sites', project.slug), { recursive: true, force: true }).catch(() => undefined);
    }

    return { ok: true };
  }

  // ----- helpers -----

  private async uniqueSlug(teamId: string, name: string): Promise<string> {
    const base = slugify(name);
    let slug = base;
    let i = 1;
    while (
      await this.prisma.project.findFirst({ where: { teamId, slug } })
    ) {
      slug = `${base}-${i++}`;
    }
    return slug;
  }

  private toSummary(p: ProjectWithRels): ProjectSummary {
    const primary = p.domains?.[0];
    const latest = p.deployments?.[0];
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      type: p.type,
      primaryDomain: primary?.hostname,
      latestDeployment: latest
        ? {
            id: latest.id,
            status: latest.status,
            createdAt: latest.queuedAt.toISOString(),
          }
        : undefined,
    };
  }

  private toDetail(p: ProjectWithRels): ProjectDetailDto {
    return {
      id: p.id,
      teamId: p.teamId,
      name: p.name,
      slug: p.slug,
      type: p.type,
      gitRepoUrl: p.gitRepoUrl,
      gitBranch: p.gitBranch,
      rootDir: p.rootDir,
      hasGitToken: !!p.gitToken,
      installCommand: p.installCommand,
      buildCommand: p.buildCommand,
      startCommand: p.startCommand,
      outputDir: p.outputDir,
      internalPort: p.internalPort,
      autoDeploy: p.autoDeploy,
      sleepEnabled: p.sleepEnabled,
      memoryMb: p.memoryMb,
      cpuLimit: p.cpuLimit,
      notifyUrl: p.notifyUrl,
      serverId: (p as any).serverId ?? null,
      domains: (p.domains ?? []).map((d) => ({
        id: d.id,
        hostname: d.hostname,
        isPrimary: d.isPrimary,
        status: d.status,
      })),
      deployments: (p.deployments ?? []).map((d) => ({
        id: d.id,
        projectId: d.projectId,
        status: d.status,
        trigger: d.trigger,
        commitSha: d.commitSha,
        commitMsg: d.commitMsg,
        queuedAt: d.queuedAt.toISOString(),
        startedAt: d.startedAt?.toISOString() ?? null,
        finishedAt: d.finishedAt?.toISOString() ?? null,
        errorMessage: d.errorMessage,
      })),
      webhookUrl: `${this.config.get<string>('PUBLIC_API_URL', 'http://localhost:4000')}/api/v1/webhooks/git/${p.id}`,
      webhookSecret: p.webhookSecret,
      createdAt: p.createdAt.toISOString(),
    };
  }
}
