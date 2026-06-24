import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Deployment, Domain, Project } from '@prisma/client';
import type {
  CreateProjectDto,
  Paginated,
  ProjectDetailDto,
  ProjectSummary,
  UpdateProjectDto,
} from '@deploybox/shared';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';

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
  ) {}

  // ----- truy cập theo team (nền tảng cô lập tenant) -----

  private async assertMembership(userId: string, teamId: string): Promise<void> {
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member) {
      throw new ForbiddenException('Bạn không thuộc team này');
    }
  }

  private async loadOwnedProject(
    userId: string,
    projectId: string,
  ): Promise<Project> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException('Không tìm thấy project');
    }
    await this.assertMembership(userId, project.teamId);
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
    await this.assertMembership(userId, teamId);
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
        buildCommand: dto.buildCommand,
        startCommand: dto.startCommand,
        outputDir: dto.outputDir,
        internalPort: dto.internalPort ?? 3000,
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
        deployments: { orderBy: { queuedAt: 'desc' }, take: 10 },
      },
    });
    return this.toDetail(project);
  }

  async update(
    userId: string,
    projectId: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectDetailDto> {
    await this.loadOwnedProject(userId, projectId);
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...dto,
        // chuỗi rỗng từ form -> null
        gitRepoUrl: dto.gitRepoUrl === '' ? null : dto.gitRepoUrl,
        buildImage: dto.buildImage === '' ? null : dto.buildImage,
        artifactPath: dto.artifactPath === '' ? null : dto.artifactPath,
      },
    });
    return this.get(userId, projectId);
  }

  async remove(
    userId: string,
    projectId: string,
  ): Promise<{ ok: true }> {
    await this.loadOwnedProject(userId, projectId);
    // M1: chỉ xóa bản ghi. Khi có build engine sẽ kèm dừng container + gỡ route Caddy.
    await this.prisma.project.delete({ where: { id: projectId } });
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
      installCommand: p.installCommand,
      buildCommand: p.buildCommand,
      startCommand: p.startCommand,
      outputDir: p.outputDir,
      internalPort: p.internalPort,
      autoDeploy: p.autoDeploy,
      sleepEnabled: p.sleepEnabled,
      memoryMb: p.memoryMb,
      cpuLimit: p.cpuLimit,
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
