'use server';

import { serverApi } from '@/lib/api-server';

export type TelegramStatus = {
  enabled: boolean;
  connected: boolean;
  botUsername: string | null;
};

export async function getTelegramStatusAction(): Promise<TelegramStatus | null> {
  try {
    return await serverApi<TelegramStatus>('/me/telegram');
  } catch {
    return null;
  }
}

export async function createTelegramLinkAction(): Promise<{
  ok: boolean;
  url?: string;
  error?: string;
}> {
  try {
    return await serverApi<{ ok: boolean; url?: string; error?: string }>(
      '/me/telegram/link',
      { method: 'POST' },
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Lỗi' };
  }
}

export async function unlinkTelegramAction(): Promise<{ ok: boolean }> {
  try {
    await serverApi('/me/telegram', { method: 'DELETE' });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
