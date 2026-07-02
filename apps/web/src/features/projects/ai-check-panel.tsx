'use client';

import { useState } from 'react';
import type { EnvVarDto, ProjectCheckResult } from '@deploybox/shared';
import { Button } from '@/components/ui/button';
import { aiCheckProjectAction } from './actions';

/**
 * 🔍 Kiểm tra AI cho project: env thiếu + secret lộ trong repo.
 * Hiện cảnh báo ngay từ dữ liệu đã lưu (requiredEnvKeys vs env đã khai);
 * bấm nút để AI quét lại repo (clone bằng token đã lưu).
 */
export function AiCheckPanel({
  projectId,
  requiredEnvKeys,
  envVars,
  hasRepo,
}: {
  projectId: string;
  requiredEnvKeys: string[];
  envVars: EnvVarDto[];
  hasRepo: boolean;
}) {
  const declared = new Set(envVars.map((v) => v.key));
  const initialMissing = requiredEnvKeys.filter((k) => !declared.has(k));

  const [result, setResult] = useState<ProjectCheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missing = result ? result.missingEnv : initialMissing;
  const secrets = result?.secretWarnings ?? [];

  async function run() {
    setLoading(true);
    setError(null);
    const res = await aiCheckProjectAction(projectId);
    setLoading(false);
    if (res.ok && res.data) setResult(res.data);
    else if (!res.ok) setError(res.error);
  }

  if (!hasRepo) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white/70">🔍 Kiểm tra AI</h2>
          <p className="text-xs text-white/40">
            Quét repo: biến env app cần (so với tab Env) + secret bị lộ.
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={run}
          disabled={loading}
          className="shrink-0 px-2 py-1 text-xs text-sky-300"
        >
          {loading ? 'Đang quét repo…' : 'Quét ngay'}
        </Button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {missing.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs">
          <p className="font-medium text-amber-300">
            ⚠️ Thiếu {missing.length} biến env app cần:
          </p>
          <p className="mt-1 text-amber-200/80">
            <code>{missing.join(', ')}</code>
          </p>
          <p className="mt-1 text-white/40">Thêm ở tab Env rồi deploy lại — tránh app lỗi lúc chạy.</p>
        </div>
      )}

      {secrets.length > 0 && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs">
          <p className="font-medium text-red-300">🚨 Secret bị lộ trong repo:</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-red-200/80">
            {secrets.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {result && missing.length === 0 && secrets.length === 0 && (
        <p className="text-xs text-emerald-400">
          ✅ Không thiếu env, không thấy secret lộ ({result.framework || 'repo'} OK).
        </p>
      )}
      {!result && missing.length === 0 && requiredEnvKeys.length > 0 && (
        <p className="text-xs text-emerald-400/70">✅ Đủ {requiredEnvKeys.length} biến env app cần.</p>
      )}
    </div>
  );
}
