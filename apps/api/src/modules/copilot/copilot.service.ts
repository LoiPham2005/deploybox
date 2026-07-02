import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AiService } from '../../infra/ai/ai.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';
import { DeploymentsService } from '../deployments/deployments.service';

export interface CopilotMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CopilotReply {
  reply: string;
  // Hành động AI đề xuất — UI hiện nút xác nhận, KHÔNG tự chạy
  action: 'none' | 'deploy' | 'stop';
  projectId: string;
  projectName: string;
  onboarding: boolean; // đang ở chế độ dẫn người mới
}

/**
 * 🤖 Copilot trong dashboard: chat hỏi về project + đề xuất hành động (cần xác nhận).
 * Chế độ ONBOARDING tự bật khi user chưa có project nào (dẫn từng bước tạo project đầu tiên).
 */
@Injectable()
export class CopilotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly flags: FeatureFlagsService,
    private readonly deployments: DeploymentsService,
  ) {}

  /** Project user có quyền xem + trạng thái deploy gần nhất (context cho AI). */
  private async projectContext(userId: string): Promise<{
    text: string;
    projects: { id: string; name: string; slug: string }[];
  }> {
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true, role: true },
    });
    const ownerTeams = memberships.filter((m) => m.role === 'OWNER').map((m) => m.teamId);
    const memberTeams = memberships.filter((m) => m.role !== 'OWNER').map((m) => m.teamId);
    const projects = await this.prisma.project.findMany({
      where: {
        OR: [
          { teamId: { in: ownerTeams } },
          { teamId: { in: memberTeams }, members: { some: { userId } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: {
        id: true, name: true, slug: true, type: true, gitBranch: true,
        deployments: {
          orderBy: { queuedAt: 'desc' },
          take: 1,
          select: { status: true, errorMessage: true, aiDiagnosis: true, finishedAt: true, queuedAt: true },
        },
      },
    });
    const text = projects
      .map((p) => {
        const d = p.deployments[0];
        const diag = d?.aiDiagnosis as { cause?: string } | null;
        return [
          `• ${p.name} (slug: ${p.slug}, ${p.type}, nhánh ${p.gitBranch})`,
          `  Deploy gần nhất: ${d ? `${d.status} lúc ${(d.finishedAt ?? d.queuedAt).toISOString()}` : 'chưa có'}`,
          d?.errorMessage ? `  Lỗi: ${d.errorMessage.slice(0, 200)}` : null,
          diag?.cause ? `  AI chẩn đoán: ${diag.cause.slice(0, 200)}` : null,
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n');
    return {
      text,
      projects: projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
    };
  }

  /** 1 lượt chat. */
  async message(userId: string, messages: CopilotMessage[]): Promise<CopilotReply> {
    if (!this.flags.aiEnabled('ai_copilot')) {
      throw new BadRequestException('Copilot đang tắt (Admin → Tính năng hệ thống).');
    }
    const last = messages.filter((m) => m.role === 'user').pop();
    if (!last?.content?.trim()) throw new BadRequestException('Chưa có câu hỏi');

    const ctx = await this.projectContext(userId);
    const onboarding =
      ctx.projects.length === 0 && this.flags.aiEnabled('ai_onboarding');

    const history = messages
      .slice(-8, -1) // vài lượt gần nhất, trừ câu hỏi hiện tại
      .map((m) => `${m.role === 'user' ? 'Người dùng' : 'Copilot'}: ${m.content.slice(0, 400)}`)
      .join('\n');

    const turn = await this.ai.copilotTurn({
      question: last.content.slice(0, 1_000),
      history,
      context: ctx.text,
      onboarding,
    });

    // Chỉ chấp nhận action trên project user thật sự có quyền
    let projectId = '';
    let projectName = '';
    if (turn.action !== 'none' && turn.projectSlug) {
      const p = ctx.projects.find(
        (x) => x.slug.toLowerCase() === turn.projectSlug.toLowerCase(),
      );
      if (p) {
        projectId = p.id;
        projectName = p.name;
      }
    }
    return {
      reply: turn.reply,
      action: projectId ? turn.action : 'none',
      projectId,
      projectName,
      onboarding,
    };
  }

  /** User bấm nút xác nhận → thực thi (RBAC nằm trong DeploymentsService). */
  async executeAction(
    userId: string,
    projectId: string,
    action: 'deploy' | 'stop',
  ): Promise<{ ok: true; message: string; deploymentId?: string }> {
    if (!this.flags.aiEnabled('ai_copilot')) {
      throw new BadRequestException('Copilot đang tắt.');
    }
    if (action === 'deploy') {
      const dep = await this.deployments.deploy(userId, projectId);
      return { ok: true, message: 'Đã xếp hàng deploy 🚀', deploymentId: dep.id };
    }
    await this.deployments.stop(userId, projectId);
    return { ok: true, message: 'Đã tắt app 🛑' };
  }
}
