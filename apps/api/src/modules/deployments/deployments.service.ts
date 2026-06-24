import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Deployment, ProjectType } from '@prisma/client';
import type { DeploymentDetail, DeploymentView } from '@deploybox/shared';
import { Queue } from 'bullmq';
import { readFile, rm } from 'fs/promises';
import { join, resolve } from 'path';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { DockerService } from '../../infra/docker/docker.service';
import { CaddyService } from '../../infra/caddy/caddy.service';
import { SleepService } from '../../infra/sleep/sleep.service';
import { BUILD_QUEUE, type BuildJobData } from './queue.constants';

@Injectable()
export class DeploymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly docker: DockerService,
    private readonly caddy: CaddyService,
    private readonly sleepSvc: SleepService,
    @InjectQueue(BUILD_QUEUE) private readonly buildQueue: Queue<BuildJobData>,
  ) {}

  private async assertMembership(userId: string, teamId: string): Promise<void> {
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member) throw new ForbiddenException('Bạn không thuộc team này');
  }

  private async loadOwnedProject(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Không tìm thấy project');
    await this.assertMembership(userId, project.teamId);
    return project;
  }

  async deploy(userId: string, projectId: string): Promise<DeploymentDetail> {
    return this.enqueue(userId, projectId, 'MANUAL');
  }

  async redeploy(userId: string, projectId: string): Promise<DeploymentDetail> {
    return this.enqueue(userId, projectId, 'REDEPLOY');
  }

  async rollback(
    userId: string,
    deploymentId: string,
  ): Promise<DeploymentDetail> {
    const src = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: { project: true },
    });
    if (!src) throw new NotFoundException('Không tìm thấy deployment');
    await this.assertMembership(userId, src.project.teamId);
    const deployment = await this.prisma.deployment.create({
      data: {
        projectId: src.projectId,
        status: 'QUEUED',
        trigger: 'REDEPLOY',
        createdBy: userId,
      },
    });
    await this.buildQueue.add(
      'build',
      { deploymentId: deployment.id, rollbackOf: deploymentId },
      { removeOnComplete: 50, removeOnFail: 50 },
    );
    return this.toDetail(deployment);
  }

  /** Trigger từ webhook git (đã xác thực ở WebhooksService — không kiểm user). */
  async deployFromPush(
    projectId: string,
    commitSha?: string,
    commitMsg?: string,
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project?.gitRepoUrl) return;
    const deployment = await this.prisma.deployment.create({
      data: {
        projectId,
        status: 'QUEUED',
        trigger: 'GIT_PUSH',
        commitSha,
        commitMsg,
      },
    });
    await this.buildQueue.add(
      'build',
      { deploymentId: deployment.id },
      { removeOnComplete: 50, removeOnFail: 50 },
    );
  }

  private async enqueue(
    userId: string,
    projectId: string,
    trigger: 'MANUAL' | 'REDEPLOY',
  ): Promise<DeploymentDetail> {
    const project = await this.loadOwnedProject(userId, projectId);
    if (!project.gitRepoUrl) {
      throw new BadRequestException('Project chưa có Git repo URL để deploy');
    }
    const deployment = await this.prisma.deployment.create({
      data: { projectId, status: 'QUEUED', trigger, createdBy: userId },
    });
    await this.buildQueue.add(
      'build',
      { deploymentId: deployment.id },
      { removeOnComplete: 50, removeOnFail: 50 },
    );
    return this.toDetail(deployment);
  }

  async stop(userId: string, projectId: string): Promise<{ ok: true }> {
    const project = await this.loadOwnedProject(userId, projectId);
    if (project.type === 'STATIC') {
      const dataDir = resolve(
        process.cwd(),
        this.config.get<string>('DATA_DIR', '.deploybox-data'),
      );
      await rm(join(dataDir, 'sites', project.slug), {
        recursive: true,
        force: true,
      });
    } else {
      await this.docker
        .remove(`deploybox-${project.slug}`)
        .catch(() => undefined);
    }
    const latest = await this.prisma.deployment.findFirst({
      where: { projectId, status: 'RUNNING' },
      orderBy: { queuedAt: 'desc' },
    });
    if (latest) {
      await this.prisma.deployment.update({
        where: { id: latest.id },
        data: { status: 'STOPPED' },
      });
    }
    await this.prisma.domain.updateMany({
      where: { projectId, isPrimary: true },
      data: { status: 'PENDING_DNS' },
    });
    await this.caddy.sync().catch(() => undefined);
    return { ok: true };
  }

  async sleepProject(
    userId: string,
    projectId: string,
  ): Promise<{ ok: boolean }> {
    await this.loadOwnedProject(userId, projectId);
    return { ok: await this.sleepSvc.sleep(projectId) };
  }

  async list(userId: string, projectId: string): Promise<DeploymentDetail[]> {
    await this.loadOwnedProject(userId, projectId);
    const deployments = await this.prisma.deployment.findMany({
      where: { projectId },
      orderBy: { queuedAt: 'desc' },
      take: 20,
    });
    return deployments.map((d) => this.toDetail(d));
  }

  async getView(userId: string, deploymentId: string): Promise<DeploymentView> {
    const deployment = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: { project: true },
    });
    if (!deployment) throw new NotFoundException('Không tìm thấy deployment');
    await this.assertMembership(userId, deployment.project.teamId);

    const logs = await this.readLogs(deploymentId);
    const isMobile = deployment.project.type === ProjectType.MOBILE;
    const url = isMobile ? null : this.resolveUrl(deployment);
    const artifactUrl = isMobile
      ? this.resolveArtifactUrl(deployment)
      : null;

    return {
      deployment: this.toDetail(deployment),
      project: {
        id: deployment.project.id,
        name: deployment.project.name,
        slug: deployment.project.slug,
        type: deployment.project.type,
      },
      url,
      artifactUrl,
      logs,
    };
  }

  private resolveUrl(deployment: {
    status: string;
    project: { slug: string };
  }): string | null {
    if (deployment.status !== 'RUNNING') return null;
    return this.caddy.publicUrl(deployment.project.slug);
  }

  private resolveArtifactUrl(deployment: {
    status: string;
    staticPath?: string | null;
  }): string | null {
    if (deployment.status !== 'RUNNING' || !deployment.staticPath) return null;
    const apiUrl = this.config.get<string>('PUBLIC_API_URL', `http://localhost:${this.config.get('PORT', 4000)}`);
    return `${apiUrl}/${deployment.staticPath}`;
  }

  private async readLogs(deploymentId: string): Promise<string> {
    const dataDir = resolve(
      process.cwd(),
      this.config.get<string>('DATA_DIR', '.deploybox-data'),
    );
    try {
      return await readFile(
        join(dataDir, 'logs', `${deploymentId}.log`),
        'utf8',
      );
    } catch {
      return '';
    }
  }

  private toDetail(d: Deployment): DeploymentDetail {
    return {
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
    };
  }
}
