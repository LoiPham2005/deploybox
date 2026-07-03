import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PLAN_LIMITS, isAdminRole } from '@deploybox/shared';
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
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';
import { AiService } from '../../infra/ai/ai.service';
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
    private readonly flags: FeatureFlagsService,
    private readonly ai: AiService,
  ) {}

  /** ⚙️ AI sinh GitHub Actions workflow gọi API deploy của project này. */
  async generateCi(userId: string, projectId: string): Promise<{ yaml: string }> {
    if (!this.flags.aiEnabled('ai_ci_generator')) {
      throw new ForbiddenException('Tính năng "Sinh file CI" đang tắt (Admin → Tính năng hệ thống).');
    }
    const project = await this.loadOwnedProject(userId, projectId);
    const apiUrl = this.config.get<string>('PUBLIC_API_URL', 'http://localhost:4000');
    const yaml = await this.ai.generateCi({
      projectName: project.name,
      branch: project.gitBranch,
      apiUrl,
      projectId: project.id,
    });
    return { yaml };
  }

  // ----- truy cập theo team (nền tảng cô lập tenant) -----

  private static readonly ROLE_ORDER: Record<TeamRole, number> = {
    MEMBER: 0,
    OWNER: 1,
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

  /** Admin hệ thống — bỏ qua mọi giới hạn gói. */
  private async isPlatformAdmin(userId: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return isAdminRole(u?.role);
  }

  /**
   * Quyền xem/dùng 1 project ở cấp thành viên:
   * - OWNER của team → xem hết project trong team
   * - MEMBER → chỉ project được cấp quyền (ProjectMember)
   * Lưu ý: admin hệ thống KHÔNG tự động xem được — quyền project theo team,
   * admin chỉ "toàn quyền" ở giới hạn gói + Admin Panel, không phải xem lén team khác.
   */
  private async assertProjectAccess(
    userId: string,
    project: { id: string; teamId: string },
  ): Promise<void> {
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: project.teamId, userId } },
    });
    if (!member) throw new ForbiddenException('Bạn không thuộc team này');
    if (member.role === 'OWNER') return; // OWNER thấy mọi project
    const access = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId } },
    });
    if (!access) {
      throw new ForbiddenException('Bạn không được cấp quyền xem project này');
    }
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
    if (minRole === 'OWNER') {
      await this.assertRole(userId, project.teamId, 'OWNER');
    } else {
      // Xem chi tiết: cần quyền project (OWNER thấy hết, MEMBER cần được cấp)
      await this.assertProjectAccess(userId, project);
    }
    return project;
  }

  // ----- CRUD -----

  async list(
    userId: string,
    teamId: string,
  ): Promise<Paginated<ProjectSummary>> {
    await this.assertMembership(userId, teamId);
    // OWNER thấy hết project của team; MEMBER chỉ thấy project được cấp quyền
    // (kể cả admin hệ thống — quyền project theo vai trò trong team, không phải isAdmin)
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    const seesAll = member?.role === 'OWNER';
    const projects = await this.prisma.project.findMany({
      where: seesAll ? { teamId } : { teamId, members: { some: { userId } } },
      orderBy: { createdAt: 'desc' },
      include: {
        domains: { where: { isPrimary: true }, take: 1 },
        deployments: { orderBy: { queuedAt: 'desc' }, take: 1 },
      },
    });
    const data = projects.map((p) => this.toSummary(p));
    return { data, total: data.length, page: 1, pageSize: data.length };
  }

  /** Mọi project user truy cập được (mọi team) — cho CLI. */
  async listAccessible(userId: string): Promise<import('@deploybox/shared').CliProjectDto[]> {
    const projects = await this.prisma.project.findMany({
      where: {
        OR: [
          { team: { members: { some: { userId, role: 'OWNER' } } } },
          { members: { some: { userId } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: { deployments: { orderBy: { queuedAt: 'desc' }, take: 1 } },
    });
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      teamId: p.teamId,
      type: p.type,
      status: p.deployments[0]?.status ?? 'NONE',
      url: p.deployments[0]?.status === 'RUNNING' ? this.publicUrl(p.slug) : null,
    }));
  }

  /** URL công khai của project (tự dựng, khớp CaddyService.publicUrl). */
  private publicUrl(slug: string): string {
    const domain = this.config.get<string>('APP_DOMAIN', 'localhost');
    const port = this.config.get<string>('PROXY_PORT', '8080');
    return domain === 'localhost'
      ? `http://${slug}.${domain}:${port}/`
      : `https://${slug}.${domain}/`;
  }

  async create(
    userId: string,
    teamId: string,
    dto: CreateProjectDto,
  ): Promise<ProjectSummary> {
    await this.assertRole(userId, teamId, 'OWNER');

    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    // Admin hệ thống, hoặc admin đã TẮT giới hạn theo gói → không giới hạn
    const isAdmin = await this.isPlatformAdmin(userId);
    const noLimit = isAdmin || !this.flags.isEnabled('plan_limits_enabled');
    const limit = noLimit ? -1 : PLAN_LIMITS[team.plan as 'FREE' | 'PRO'].projects;
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
        useDocker: dto.useDocker ?? true,
        requiredEnvKeys: dto.requiredEnvKeys ?? [],
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
    await this.loadOwnedProject(userId, projectId, 'OWNER');
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
        // hook: '' = xoá (null), undefined = không đổi
        preDeployCommand: dto.preDeployCommand === undefined
          ? undefined
          : dto.preDeployCommand === '' ? null : dto.preDeployCommand,
        postDeployCommand: dto.postDeployCommand === undefined
          ? undefined
          : dto.postDeployCommand === '' ? null : dto.postDeployCommand,
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
      preDeployCommand: (p as { preDeployCommand?: string | null }).preDeployCommand ?? null,
      postDeployCommand: (p as { postDeployCommand?: string | null }).postDeployCommand ?? null,
      internalPort: p.internalPort,
      autoDeploy: p.autoDeploy,
      sleepEnabled: p.sleepEnabled,
      useDocker: (p as { useDocker?: boolean }).useDocker ?? true,
      memoryMb: p.memoryMb,
      cpuLimit: p.cpuLimit,
      notifyUrl: p.notifyUrl,
      serverId: (p as any).serverId ?? null,
      requiredEnvKeys: (p as { requiredEnvKeys?: string[] }).requiredEnvKeys ?? [],
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
