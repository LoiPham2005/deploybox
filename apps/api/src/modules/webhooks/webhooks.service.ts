import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { DeploymentsService } from '../deployments/deployments.service';
import { NotifyService } from '../../infra/notify/notify.service';
import { FeatureFlagsService } from '../../infra/feature-flags/feature-flags.service';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface PushPayload {
  // GitHub / GitLab
  ref?: string;
  after?: string;
  head_commit?: { message?: string };
  // GitHub & GitLab đều gửi danh sách file đổi trong từng commit
  commits?: Array<{
    message?: string;
    added?: string[];
    modified?: string[];
    removed?: string[];
  }>;
  // Bitbucket
  push?: {
    changes?: Array<{
      new?: {
        type?: string;
        name?: string;
        target?: { hash?: string; message?: string };
      };
    }>;
  };
}

/** Rút branch + commit từ payload của cả 3 nhà (format khác nhau). */
function extractPush(
  source: string,
  data: PushPayload,
): { branch: string; commitSha?: string; commitMsg?: string } {
  if (source === 'bitbucket') {
    const change =
      data.push?.changes?.find((c) => c.new?.type === 'branch') ??
      data.push?.changes?.[0];
    return {
      branch: change?.new?.name ?? '',
      commitSha: change?.new?.target?.hash,
      commitMsg: change?.new?.target?.message,
    };
  }
  // GitHub / GitLab
  return {
    branch: (data.ref ?? '').replace('refs/heads/', ''),
    commitSha: data.after,
    commitMsg:
      data.head_commit?.message ??
      data.commits?.[data.commits.length - 1]?.message,
  };
}

// File "chỉ tài liệu/ảnh" — đổi mấy cái này không cần deploy lại
const DOCS_ONLY_RE =
  /(^|\/)(docs?|\.github)\/|\.(md|mdx|txt|png|jpe?g|gif|svg|ico)$|(^|\/)(readme|license|changelog|contributing|authors)(\.[a-z]+)?$/i;
// File đụng schema DB — deploy vẫn chạy nhưng cảnh báo
const SCHEMA_RE = /schema\.prisma$|(^|\/)migrations?\//i;

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deployments: DeploymentsService,
    private readonly notify: NotifyService,
    private readonly flags: FeatureFlagsService,
  ) {}

  async handlePush(
    projectId: string,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
    payload: unknown,
  ): Promise<{ deployed: boolean; reason?: string }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Không tìm thấy project');
    if (!project.webhookSecret) {
      throw new UnauthorizedException('Project chưa có webhook secret');
    }

    // Xác định nguồn
    const source = headers['x-github-event'] ? 'github'
      : headers['x-gitlab-event'] ? 'gitlab'
      : 'bitbucket';

    // Xác thực theo từng nhà:
    // - GitHub:    HMAC-SHA256 trong header X-Hub-Signature-256
    // - Bitbucket: HMAC-SHA256 trong header X-Hub-Signature (không có "-256")
    // - GitLab:    token thẳng trong header X-Gitlab-Token
    const ghSig = headers['x-hub-signature-256'];
    const bbSig = headers['x-hub-signature'];
    const glToken = headers['x-gitlab-token'];
    const hmac = () =>
      'sha256=' +
      createHmac('sha256', project.webhookSecret!).update(rawBody).digest('hex');
    let ok = false;
    if (typeof ghSig === 'string') ok = safeEqual(ghSig, hmac()); // GitHub
    else if (typeof bbSig === 'string') ok = safeEqual(bbSig, hmac()); // Bitbucket
    else if (typeof glToken === 'string') ok = safeEqual(glToken, project.webhookSecret); // GitLab
    if (!ok) {
      await this.logEvent(projectId, source, undefined, undefined, 'rejected', 'Chữ ký không hợp lệ');
      throw new UnauthorizedException('Chữ ký webhook không hợp lệ');
    }

    const data = (payload ?? {}) as PushPayload;
    const { branch, commitSha, commitMsg } = extractPush(source, data);
    if (branch && branch !== project.gitBranch) {
      const reason = `Bỏ qua: push lên branch ${branch}`;
      await this.logEvent(projectId, source, branch, commitSha, 'skipped', reason);
      return { deployed: false, reason };
    }
    if (!project.autoDeploy) {
      const reason = 'autoDeploy đang tắt';
      await this.logEvent(projectId, source, branch, commitSha, 'skipped', reason);
      return { deployed: false, reason };
    }

    // 🧠 Auto-deploy có não: xem danh sách file đổi (GitHub/GitLab gửi kèm;
    // Bitbucket không có → deploy như thường)
    const changedFiles = (data.commits ?? []).flatMap((c) => [
      ...(c.added ?? []),
      ...(c.modified ?? []),
      ...(c.removed ?? []),
    ]);
    if (this.flags.aiEnabled('ai_smart_autodeploy') && changedFiles.length) {
      // Chỉ đổi tài liệu/ảnh → khỏi deploy, đỡ tốn 1 lần build
      if (changedFiles.every((f) => DOCS_ONLY_RE.test(f))) {
        const reason = `🧠 Bỏ qua: ${changedFiles.length} file đổi đều là tài liệu/ảnh`;
        await this.logEvent(projectId, source, branch, commitSha, 'skipped', reason);
        return { deployed: false, reason };
      }
      // Đụng schema DB → vẫn deploy nhưng cảnh báo trước
      const schemaFiles = changedFiles.filter((f) => SCHEMA_RE.test(f));
      if (schemaFiles.length) {
        const members = await this.prisma.teamMember.findMany({
          where: { teamId: project.teamId },
          select: { user: { select: { telegramChatId: true } } },
        });
        void this.notify.broadcast(
          `🧠 <b>Deploy tự động có THAY ĐỔI SCHEMA DB</b> · 📦 <b>${project.name}</b>\n` +
            `File: <code>${schemaFiles.slice(0, 3).join(', ')}</code>\n` +
            `Kiểm tra kỹ migration — sai là mất dữ liệu.`,
          members.map((m) => m.user.telegramChatId).filter((x): x is string => !!x),
        );
      }
    }

    await this.deployments.deployFromPush(projectId, commitSha, commitMsg);
    await this.logEvent(projectId, source, branch, commitSha, 'deployed');
    return { deployed: true };
  }

  async listEvents(
    userId: string,
    projectId: string,
  ): Promise<{ id: string; source: string; branch?: string | null; commitSha?: string | null; status: string; reason?: string | null; createdAt: string }[]> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return [];
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: project.teamId, userId } },
    });
    if (!member) return [];
    const events = await this.prisma.webhookEvent.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return events.map((e) => ({
      id: e.id,
      source: e.source,
      branch: e.branch,
      commitSha: e.commitSha,
      status: e.status,
      reason: e.reason,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  private async logEvent(
    projectId: string,
    source: string,
    branch: string | undefined,
    commitSha: string | undefined,
    status: string,
    reason?: string,
  ): Promise<void> {
    await this.prisma.webhookEvent.create({
      data: { projectId, source, branch, commitSha, status, reason },
    }).catch(() => undefined);
  }
}
