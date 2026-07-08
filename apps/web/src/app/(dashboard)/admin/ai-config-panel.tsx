'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { AiConfigStatus, AiProviderId } from '@deploybox/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setAiConfigAction, setAiKeyAction } from './actions';

export function AiConfigPanel({ config }: { config: AiConfigStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [provider, setProvider] = useState<AiProviderId>(config.provider);
  const [model, setModel] = useState(config.model);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Nhập/sửa API key cho provider đang chọn
  const [keyInput, setKeyInput] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMsg, setKeyMsg] = useState<string | null>(null);

  const current = config.providers.find((p) => p.id === provider);

  function saveKey() {
    setKeyMsg(null);
    setErr(null);
    setKeyBusy(true);
    startTransition(async () => {
      const res = await setAiKeyAction(provider, keyInput.trim());
      setKeyBusy(false);
      if (res.ok) {
        setKeyInput('');
        setKeyMsg(keyInput.trim() ? 'Đã lưu API key ✓' : 'Đã xoá key (về .env) ✓');
        router.refresh();
      } else setErr(res.error);
    });
  }
  const dirty = provider !== config.provider || model.trim() !== config.model;
  const usingLabel =
    config.providers.find((p) => p.id === config.provider)?.label ?? config.provider;

  function pick(id: AiProviderId) {
    setProvider(id);
    setSaved(false);
    // Đổi provider → gợi ý model đầu của provider đó; quay lại provider cũ → model cũ.
    if (id === config.provider) {
      setModel(config.model);
    } else {
      const p = config.providers.find((x) => x.id === id);
      setModel(p?.suggestedModels[0] ?? '');
    }
  }

  function save() {
    setErr(null);
    setSaved(false);
    startTransition(async () => {
      const res = await setAiConfigAction(provider, model.trim());
      if (res.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setErr(res.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Chọn nhà cung cấp */}
      <div className="grid grid-cols-3 gap-2">
        {config.providers.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => pick(p.id)}
            className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
              provider === p.id
                ? 'border-sky-400/60 bg-sky-500/10'
                : 'border-white/[0.06] bg-white/[0.03] hover:border-white/20'
            }`}
          >
            <span className="font-medium text-white/85">{p.label}</span>
            <span
              className={`mt-1 block text-[10px] ${
                p.configured ? 'text-emerald-300' : 'text-white/35'
              }`}
            >
              {p.keySource === 'db'
                ? '● key (nhập ở đây)'
                : p.keySource === 'env'
                  ? '● key (.env)'
                  : '○ chưa có key'}
            </span>
          </button>
        ))}
      </div>

      {/* Chọn / gõ model */}
      <div>
        <label className="mb-1 block text-xs text-white/50">
          Model của {current?.label}
        </label>
        <input
          list={`ai-models-${provider}`}
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            setSaved(false);
          }}
          placeholder="Nhập tên model…"
          className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white/85 outline-none focus:border-sky-400/50"
        />
        <datalist id={`ai-models-${provider}`}>
          {current?.suggestedModels.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <p className="mt-1 text-[11px] text-white/30">
          Chọn từ gợi ý hoặc gõ tên model bất kỳ mà tài khoản của bạn hỗ trợ.
        </p>
      </div>

      {/* API key của provider đang chọn — nhập/sửa ngay đây, khỏi SSH sửa .env */}
      {current && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-medium text-white/60">
              API key của {current.label}
            </label>
            <span className="text-[10px] text-white/35">
              {current.keySource === 'db'
                ? 'đang dùng key nhập ở đây'
                : current.keySource === 'env'
                  ? 'đang dùng key từ .env'
                  : 'chưa có key'}
            </span>
          </div>
          <div className="flex gap-2">
            <Input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={
                current.configured ? '•••••• (nhập key mới để thay)' : 'Dán API key…'
              }
              autoComplete="off"
            />
            <Button
              type="button"
              onClick={saveKey}
              disabled={keyBusy || !keyInput.trim()}
              className="shrink-0"
            >
              {keyBusy ? '…' : 'Lưu key'}
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-white/30">
            Key được mã hoá lưu trong DB (ưu tiên hơn .env). Có hiệu lực ngay, không cần
            restart.
            {current.keySource === 'db' && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => { setKeyInput(''); saveKey(); }}
                  className="text-red-400 hover:underline"
                >
                  Xoá key (về .env)
                </button>
              </>
            )}
          </p>
          {keyMsg && <p className="mt-1 text-xs text-emerald-400">{keyMsg}</p>}
        </div>
      )}
      {err && <p className="text-xs text-red-400">{err}</p>}

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending || !dirty || !model.trim()}>
          {pending ? 'Đang lưu…' : 'Lưu'}
        </Button>
        {saved && !dirty && (
          <span className="text-xs text-emerald-400">Đã lưu ✓</span>
        )}
        <span className="text-xs text-white/30">
          Đang dùng: {usingLabel} · {config.model}
        </span>
      </div>
    </div>
  );
}
