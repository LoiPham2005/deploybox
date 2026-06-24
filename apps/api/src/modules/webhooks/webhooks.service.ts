import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { DeploymentsService } from '../deployments/deployments.service';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface PushPayload {
  ref?: string;
  after?: string;
  head_commit?: { message?: string };
  commits?: Array<{ message?: string }>;
}

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deployments: DeploymentsService,
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

    // Xác thực: GitHub gửi HMAC-SHA256, GitLab gửi token thẳng.
    const sig = headers['x-hub-signature-256'];
    const glToken = headers['x-gitlab-token'];
    let ok = false;
    if (typeof sig === 'string') {
      const expected =
        'sha256=' +
        createHmac('sha256', project.webhookSecret)
          .update(rawBody)
          .digest('hex');
      ok = safeEqual(sig, expected);
    } else if (typeof glToken === 'string') {
      ok = safeEqual(glToken, project.webhookSecret);
    }
    if (!ok) throw new UnauthorizedException('Chữ ký webhook không hợp lệ');

    const data = (payload ?? {}) as PushPayload;
    const branch = (data.ref ?? '').replace('refs/heads/', '');
    if (branch && branch !== project.gitBranch) {
      return { deployed: false, reason: `Bỏ qua: push lên branch ${branch}` };
    }
    if (!project.autoDeploy) {
      return { deployed: false, reason: 'autoDeploy đang tắt' };
    }

    const commitMsg =
      data.head_commit?.message ??
      data.commits?.[data.commits.length - 1]?.message;
    await this.deployments.deployFromPush(projectId, data.after, commitMsg);
    return { deployed: true };
  }
}
