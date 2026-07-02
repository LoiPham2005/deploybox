'use server';

import { serverApi } from '@/lib/api-server';

export interface CopilotMsg {
  role: 'user' | 'assistant';
  content: string;
}

export interface CopilotReply {
  reply: string;
  action: 'none' | 'deploy' | 'stop';
  projectId: string;
  projectName: string;
  onboarding: boolean;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** 1 lượt chat với Copilot. */
export async function copilotMessageAction(
  messages: CopilotMsg[],
): Promise<Result<CopilotReply>> {
  try {
    const data = await serverApi<CopilotReply>('/copilot/message', {
      method: 'POST',
      body: JSON.stringify({ messages: messages.slice(-10) }),
    });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Copilot lỗi' };
  }
}

/** Xác nhận hành động Copilot đề xuất. */
export async function copilotActionAction(
  projectId: string,
  action: 'deploy' | 'stop',
): Promise<Result<{ ok: true; message: string; deploymentId?: string }>> {
  try {
    const data = await serverApi<{ ok: true; message: string; deploymentId?: string }>(
      '/copilot/action',
      { method: 'POST', body: JSON.stringify({ projectId, action }) },
    );
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Thực thi thất bại' };
  }
}
