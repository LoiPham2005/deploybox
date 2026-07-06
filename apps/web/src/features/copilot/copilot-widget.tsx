'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Send, X } from 'lucide-react';
import {
  copilotActionAction,
  copilotMessageAction,
  type CopilotMsg,
  type CopilotReply,
} from './actions';

/**
 * 🤖 Copilot nổi góc phải dưới: chat hỏi về project; AI đề xuất hành động
 * (deploy/stop) → hiện nút xác nhận, bấm mới chạy thật.
 * User chưa có project → server tự bật chế độ ONBOARDING dẫn từng bước.
 */
export function CopilotWidget() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<CopilotMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<CopilotReply | null>(null); // hành động chờ xác nhận
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, busy]);

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    setInput('');
    setPending(null);
    const next: CopilotMsg[] = [...msgs, { role: 'user', content: q }];
    setMsgs(next);
    setBusy(true);
    const res = await copilotMessageAction(next);
    setBusy(false);
    if (!res.ok) {
      setMsgs([...next, { role: 'assistant', content: `⚠️ ${res.error}` }]);
      return;
    }
    setMsgs([...next, { role: 'assistant', content: res.data.reply }]);
    if (res.data.action !== 'none' && res.data.projectId) setPending(res.data);
  }

  async function confirmAction() {
    if (!pending) return;
    setBusy(true);
    const res = await copilotActionAction(pending.projectId, pending.action as 'deploy' | 'stop');
    setBusy(false);
    setMsgs((m) => [
      ...m,
      {
        role: 'assistant',
        content: res.ok ? `${res.data.message} (${pending.projectName})` : `⚠️ ${res.error}`,
      },
    ]);
    setPending(null);
    if (res.ok) router.refresh();
  }

  return (
    <>
      {/* Nút nổi */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-900/50 transition hover:bg-indigo-500"
        aria-label="Copilot"
      >
        {open ? <X size={20} /> : <Bot size={22} />}
      </button>

      {/* Khung chat */}
      {open && (
        <div className="fixed bottom-20 right-5 z-40 flex h-[480px] w-[360px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-[#12151c] shadow-2xl shadow-black/50">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
            <Bot size={16} className="text-indigo-400" />
            <p className="text-sm font-semibold text-white/85">DeployBox Copilot</p>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
            {msgs.length === 0 && (
              <div className="rounded-xl bg-white/5 p-3 text-white/60">
                Chào bạn 👋 Hỏi mình về project của bạn: <i>"app nào đang chạy?"</i>,{' '}
                <i>"vì sao deploy fail?"</i>, hoặc <i>"deploy lại app X"</i>. Chưa có
                project nào? Mình dẫn bạn tạo cái đầu tiên.
              </div>
            )}
            {msgs.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 ${
                  m.role === 'user'
                    ? 'ml-auto bg-indigo-600/80 text-white'
                    : 'bg-white/5 text-white/80'
                }`}
              >
                {m.content}
              </div>
            ))}
            {busy && <div className="text-xs text-white/40">Copilot đang nghĩ…</div>}
            {pending && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-xs text-amber-200">
                  {pending.action === 'deploy' ? '🚀 Deploy lại' : '🛑 Tắt'} app{' '}
                  <b>{pending.projectName}</b>?
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={confirmAction}
                    disabled={busy}
                    className="rounded-md bg-amber-500/90 px-3 py-1 text-xs font-medium text-black hover:bg-amber-400"
                  >
                    ✅ Xác nhận
                  </button>
                  <button
                    type="button"
                    onClick={() => setPending(null)}
                    className="rounded-md bg-white/10 px-3 py-1 text-xs text-white/60 hover:bg-white/20"
                  >
                    Huỷ
                  </button>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex items-center gap-2 border-t border-white/[0.06] p-2.5"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Hỏi Copilot…"
              className="min-w-0 flex-1 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white/85 outline-none focus:border-indigo-400/50"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white transition hover:bg-indigo-500 disabled:opacity-40"
            >
              <Send size={15} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
