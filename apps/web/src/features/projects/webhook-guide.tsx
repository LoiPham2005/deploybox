'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

const PROVIDERS = [
  { id: 'github', label: 'GitHub', emoji: '🐙' },
  { id: 'gitlab', label: 'GitLab', emoji: '🦊' },
  { id: 'bitbucket', label: 'Bitbucket', emoji: '🪣' },
] as const;

type ProviderId = (typeof PROVIDERS)[number]['id'];

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium text-white/40">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-md border border-white/[0.06] bg-black/40 px-2.5 py-1.5 text-xs text-white/80">
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          className="flex shrink-0 items-center gap-1 rounded-md border border-white/[0.06] px-2.5 py-1.5 text-xs text-white/60 hover:border-white/30 hover:text-white"
        >
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          {copied ? 'Đã copy' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold text-white/70">
        {n}
      </span>
      <span className="text-xs leading-relaxed text-white/70">{children}</span>
    </li>
  );
}

const B = ({ children }: { children: React.ReactNode }) => (
  <strong className="font-semibold text-white/90">{children}</strong>
);

export function WebhookGuide({
  webhookUrl,
  webhookSecret,
  gitBranch,
}: {
  webhookUrl: string;
  webhookSecret: string | null;
  gitBranch: string;
}) {
  const [tab, setTab] = useState<ProviderId>('github');
  const secret = webhookSecret ?? '(deploy 1 lần để tạo secret)';

  return (
    <div className="space-y-4">
      {/* URL + Secret dùng chung cho mọi provider */}
      <div className="space-y-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
        <CopyField label="Payload URL" value={webhookUrl} />
        <CopyField label="Secret" value={secret} />
      </div>

      {/* Tabs chọn nhà cung cấp */}
      <div className="flex gap-1.5">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setTab(p.id)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              tab === p.id
                ? 'border-indigo-500 bg-indigo-500/15 text-indigo-300'
                : 'border-white/[0.06] text-white/50 hover:border-white/25 hover:text-white/80'
            }`}
          >
            <span>{p.emoji}</span>
            {p.label}
          </button>
        ))}
      </div>

      {/* Hướng dẫn từng bước */}
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3.5">
        {tab === 'github' && (
          <ol className="space-y-2.5">
            <Step n={1}>Mở repo trên GitHub → tab <B>Settings</B></Step>
            <Step n={2}>Menu trái → <B>Webhooks</B> → bấm <B>Add webhook</B></Step>
            <Step n={3}><B>Payload URL</B>: dán URL ở trên</Step>
            <Step n={4}><B>Content type</B>: chọn <code className="text-white/80">application/json</code></Step>
            <Step n={5}><B>Secret</B>: dán Secret ở trên</Step>
            <Step n={6}><B>Which events?</B> → chọn <em>Just the push event</em></Step>
            <Step n={7}>Tích <B>Active</B> → bấm <B>Add webhook</B></Step>
          </ol>
        )}

        {tab === 'gitlab' && (
          <ol className="space-y-2.5">
            <Step n={1}>Mở project trên GitLab → <B>Settings</B> → <B>Webhooks</B></Step>
            <Step n={2}><B>URL</B>: dán URL ở trên</Step>
            <Step n={3}><B>Secret token</B>: dán Secret ở trên</Step>
            <Step n={4}>Mục <B>Trigger</B>: tích <B>Push events</B> (ô branch điền <code className="text-white/80">{gitBranch}</code> nếu muốn giới hạn)</Step>
            <Step n={5}>Bấm <B>Add webhook</B></Step>
          </ol>
        )}

        {tab === 'bitbucket' && (
          <ol className="space-y-2.5">
            <Step n={1}>Mở repo trên Bitbucket → <B>Repository settings</B></Step>
            <Step n={2}>Menu trái (mục Workflow) → <B>Webhooks</B> → bấm <B>Add webhook</B></Step>
            <Step n={3}><B>Title</B>: đặt tên bất kỳ, vd <code className="text-white/80">DeployBox</code></Step>
            <Step n={4}><B>URL</B>: dán URL ở trên</Step>
            <Step n={5}><B>Secret</B>: dán Secret ở trên</Step>
            <Step n={6}>Mục <B>Triggers</B>: chọn <B>Repository push</B></Step>
            <Step n={7}>Bấm <B>Save</B></Step>
          </ol>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-white/30">
        Sau khi lưu, push code lên branch <code className="text-white/50">{gitBranch}</code> sẽ
        tự động deploy (cần bật <B>Tự deploy</B> trong cấu hình). Push lên branch khác sẽ bị bỏ qua.
        Xem kết quả ở mục <B>Webhook history</B> bên dưới.
      </p>
    </div>
  );
}
