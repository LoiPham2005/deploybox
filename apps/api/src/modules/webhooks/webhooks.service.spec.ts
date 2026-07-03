import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';

const SECRET = 'webhook-secret-123';
const sign = (body: string): string =>
  'sha256=' + createHmac('sha256', SECRET).update(Buffer.from(body)).digest('hex');

const baseProject = {
  id: 'p1',
  webhookSecret: SECRET,
  gitBranch: 'main',
  autoDeploy: true,
};

function make(project: unknown) {
  const prisma = {
    project: { findUnique: vi.fn().mockResolvedValue(project) },
    teamMember: { findMany: vi.fn().mockResolvedValue([]) },
    webhookEvent: { create: vi.fn().mockResolvedValue(undefined) },
  };
  const deployments = { deployFromPush: vi.fn().mockResolvedValue(undefined) };
  const notify = { broadcast: vi.fn().mockResolvedValue(undefined) };
  // Tắt nhánh AI trong test — chỉ kiểm tra logic webhook thuần
  const flags = {
    aiEnabled: vi.fn().mockReturnValue(false),
    isEnabled: vi.fn().mockReturnValue(true),
  };
  const svc = new WebhooksService(
    prisma as never,
    deployments as never,
    notify as never,
    flags as never,
  );
  return { svc, deployments };
}

describe('WebhooksService.handlePush', () => {
  it('chữ ký HMAC đúng + đúng branch → deploy', async () => {
    const { svc, deployments } = make(baseProject);
    const body =
      '{"ref":"refs/heads/main","after":"abc","head_commit":{"message":"hi"}}';
    const res = await svc.handlePush(
      'p1',
      { 'x-github-event': 'push', 'x-hub-signature-256': sign(body) },
      Buffer.from(body),
      JSON.parse(body),
    );
    expect(res.deployed).toBe(true);
    expect(deployments.deployFromPush).toHaveBeenCalledWith('p1', 'abc', 'hi');
  });

  it('chữ ký sai → UnauthorizedException', async () => {
    const { svc } = make(baseProject);
    const body = '{"ref":"refs/heads/main"}';
    await expect(
      svc.handlePush(
        'p1',
        { 'x-github-event': 'push', 'x-hub-signature-256': 'sha256=bad' },
        Buffer.from(body),
        JSON.parse(body),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('push branch khác → không deploy', async () => {
    const { svc, deployments } = make(baseProject);
    const body = '{"ref":"refs/heads/dev"}';
    const res = await svc.handlePush(
      'p1',
      { 'x-github-event': 'push', 'x-hub-signature-256': sign(body) },
      Buffer.from(body),
      JSON.parse(body),
    );
    expect(res.deployed).toBe(false);
    expect(deployments.deployFromPush).not.toHaveBeenCalled();
  });

  it('autoDeploy tắt → không deploy', async () => {
    const { svc } = make({ ...baseProject, autoDeploy: false });
    const body = '{"ref":"refs/heads/main"}';
    const res = await svc.handlePush(
      'p1',
      { 'x-github-event': 'push', 'x-hub-signature-256': sign(body) },
      Buffer.from(body),
      JSON.parse(body),
    );
    expect(res.deployed).toBe(false);
  });

  it('GitLab token đúng → deploy', async () => {
    const { svc } = make(baseProject);
    const body = '{"ref":"refs/heads/main"}';
    const res = await svc.handlePush(
      'p1',
      { 'x-gitlab-event': 'Push Hook', 'x-gitlab-token': SECRET },
      Buffer.from(body),
      JSON.parse(body),
    );
    expect(res.deployed).toBe(true);
  });
});
