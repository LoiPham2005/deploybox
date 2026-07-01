'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  createTelegramLinkAction,
  getTelegramStatusAction,
  unlinkTelegramAction,
  type TelegramStatus,
} from './telegram-actions';

export function TelegramConnect() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [waiting, setWaiting] = useState(false); // đã mở link, chờ user bấm Start

  const refresh = useCallback(async () => {
    const s = await getTelegramStatusAction();
    setStatus(s);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Sau khi mở link: poll trạng thái để bắt lúc user bấm Start
  useEffect(() => {
    if (!waiting || status?.connected) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [waiting, status?.connected, refresh]);

  async function connect() {
    setLoading(true);
    try {
      const res = await createTelegramLinkAction();
      if (res.url) {
        setWaiting(true);
        window.open(res.url, '_blank');
      }
    } finally {
      setLoading(false);
    }
  }

  async function disconnect() {
    setLoading(true);
    try {
      await unlinkTelegramAction();
      setWaiting(false);
      await refresh();
    } finally {
      setLoading(false);
    }
  }

  if (!loaded) return <p className="text-xs text-white/30">Đang tải…</p>;
  if (!status) return <p className="text-xs text-white/40">Không tải được trạng thái Telegram.</p>;

  if (!status.enabled) {
    return (
      <p className="text-xs text-white/40">
        Instance này chưa bật thông báo Telegram (thiếu <code>TELEGRAM_BOT_TOKEN</code>).
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {status.connected ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-emerald-400">
            ✅ Đã kết nối — bạn sẽ nhận thông báo deploy qua Telegram.
          </span>
          <Button type="button" onClick={disconnect} disabled={loading}>
            {loading ? '…' : 'Ngắt kết nối'}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-white/40">
            Nối tài khoản Telegram để nhận thông báo mỗi khi deploy thành công/thất bại.
          </p>
          <Button type="button" onClick={connect} disabled={loading}>
            {loading ? '…' : 'Kết nối Telegram'}
          </Button>
          {waiting && (
            <p className="text-xs text-white/50">
              Đã mở Telegram ở tab mới — bấm <b>START</b> trong bot để hoàn tất. Trang tự cập nhật khi
              xong (vài giây).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
