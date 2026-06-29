'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Copy, Check, Terminal, GitBranch } from 'lucide-react';

const API_BASE =
  (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000') + '/api/v1';

function CopyBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="rounded-lg border border-white/10 bg-black/40">
      <div className="flex items-center justify-between border-b border-white/8 px-3 py-1.5">
        <span className="text-[11px] font-medium text-white/40">{label}</span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 text-[11px] text-white/50 hover:text-white"
        >
          {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
          {copied ? 'Đã copy' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 text-xs leading-relaxed text-white/80">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function DeployApiSnippet({ projectId }: { projectId: string }) {
  const deployUrl = `${API_BASE}/projects/${projectId}/deploy`;

  const curl = `curl -X POST ${deployUrl} \\
  -H "Authorization: Bearer $DEPLOYBOX_TOKEN"`;

  const ghAction = `# .github/workflows/deploy.yml
name: Deploy to DeployBox
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger DeployBox
        run: |
          curl -X POST ${deployUrl} \\
            -H "Authorization: Bearer \${{ secrets.DEPLOYBOX_TOKEN }}"`;

  return (
    <div className="space-y-3">
      <p className="text-xs text-white/40">
        Trigger deploy từ pipeline CI/CD (không cần mật khẩu). Tạo token ở{' '}
        <Link href="/settings/tokens" className="text-indigo-400 hover:underline">
          API Tokens
        </Link>{' '}
        rồi gán vào biến <code className="text-white/60">DEPLOYBOX_TOKEN</code>.
      </p>

      <div className="space-y-1.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-white/60">
          <Terminal size={12} /> Dòng lệnh (curl)
        </p>
        <CopyBlock label="bash" code={curl} />
      </div>

      <div className="space-y-1.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-white/60">
          <GitBranch size={12} /> GitHub Actions (tự deploy khi push)
        </p>
        <CopyBlock label="yaml" code={ghAction} />
      </div>

      <p className="text-[11px] text-white/30">
        Trong GitHub: repo → Settings → Secrets → thêm{' '}
        <code className="text-white/50">DEPLOYBOX_TOKEN</code> = token vừa tạo.
      </p>
    </div>
  );
}
