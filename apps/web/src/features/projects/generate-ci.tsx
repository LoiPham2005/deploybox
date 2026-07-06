'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { generateCiAction } from './actions';

/** ⚙️ Nút sinh GitHub Actions workflow gọi API deploy của project. */
export function GenerateCi({ projectId }: { projectId: string }) {
  const [yaml, setYaml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    const res = await generateCiAction(projectId);
    setLoading(false);
    if (res.ok && res.data) setYaml(res.data.yaml);
    else if (!res.ok) setError(res.error);
  }

  async function copy() {
    if (!yaml) return;
    await navigator.clipboard.writeText(yaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mt-3">
      <Button variant="ghost" onClick={run} disabled={loading} className="px-2 py-1 text-xs text-sky-300">
        {loading ? 'AI đang viết…' : yaml ? '🔄 Sinh lại' : '⚙️ Sinh GitHub Actions (AI)'}
      </Button>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {yaml && (
        <div className="mt-2 rounded-lg border border-white/[0.06] bg-black/40">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5">
            <span className="text-[11px] text-white/40">.github/workflows/deploy.yml</span>
            <button type="button" onClick={copy} className="flex items-center gap-1 text-[11px] text-white/50 hover:text-white">
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Đã copy' : 'Copy'}
            </button>
          </div>
          <pre className="overflow-x-auto p-3 text-[11px] leading-relaxed text-emerald-200">{yaml}</pre>
        </div>
      )}
    </div>
  );
}
