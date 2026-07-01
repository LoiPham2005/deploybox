'use client';

import { useEffect, useState } from 'react';
import type { AiDiagnosis as AiDiagnosisData } from '@deploybox/shared';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { diagnoseDeploymentAction } from '@/features/projects/actions';

// Nhớ deployment nào đã tự chẩn đoán trong phiên này → tránh gọi lại 2 lần
// (React strict-mode dev remount, hoặc mở lại trang).
const started = new Set<string>();

const CONFIDENCE: Record<
  AiDiagnosisData['confidence'],
  { label: string; cls: string }
> = {
  cao: { label: 'Tự tin cao', cls: 'bg-emerald-500/15 text-emerald-300' },
  'trung bình': { label: 'Tự tin vừa', cls: 'bg-amber-500/15 text-amber-300' },
  thấp: { label: 'Tự tin thấp', cls: 'bg-white/10 text-white/50' },
};

/**
 * Card "AI bác sĩ lỗi deploy". Nếu chưa có chẩn đoán (initial=null) thì tự gọi AI
 * 1 lần khi mở trang; đã có thì hiện luôn (đã cache ở DB). Có nút "Chẩn đoán lại".
 */
export function AiDiagnosis({
  deploymentId,
  initial,
}: {
  deploymentId: string;
  initial: AiDiagnosisData | null;
}) {
  const [diag, setDiag] = useState<AiDiagnosisData | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    const res = await diagnoseDeploymentAction(deploymentId);
    setLoading(false);
    if (res.ok && res.data) setDiag(res.data);
    else if (!res.ok) setError(res.error);
  }

  useEffect(() => {
    if (initial || started.has(deploymentId)) return;
    started.add(deploymentId);
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card className="border-sky-500/20">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white/80">
          🤖 AI chẩn đoán lỗi
          {diag && (
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] ${CONFIDENCE[diag.confidence].cls}`}
            >
              {CONFIDENCE[diag.confidence].label}
            </span>
          )}
        </h2>
        {(diag || error) && (
          <Button
            variant="ghost"
            onClick={run}
            disabled={loading}
            className="px-2 py-1 text-xs"
          >
            {loading ? '…' : 'Chẩn đoán lại'}
          </Button>
        )}
      </div>

      {loading && !diag && (
        <p className="flex items-center gap-2 text-sm text-sky-300/80">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-sky-400/40 border-t-sky-300" />
          Đang phân tích log lỗi…
        </p>
      )}

      {error && !loading && (
        <div className="space-y-2">
          <p className="text-sm text-red-300">{error}</p>
          <Button variant="ghost" onClick={run} className="px-2 py-1 text-xs">
            Thử lại
          </Button>
        </div>
      )}

      {diag && (
        <div className="space-y-3 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wide text-white/40">
              Nguyên nhân
            </p>
            <p className="text-white/85">{diag.cause}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-white/40">
              Cách sửa
            </p>
            <p className="whitespace-pre-wrap text-white/85">{diag.fix}</p>
          </div>
          {diag.commands.length > 0 && (
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-white/40">
                Lệnh / cấu hình
              </p>
              <pre className="overflow-x-auto rounded-lg bg-black/40 p-3 text-xs text-emerald-200">
                {diag.commands.join('\n')}
              </pre>
            </div>
          )}
          {diag.configField !== 'none' && diag.configValue && (
            <p className="rounded-lg bg-white/5 p-2 text-xs text-white/70">
              💡 Gợi ý sửa cấu hình:{' '}
              <code className="text-sky-300">{diag.configField}</code> ={' '}
              <code className="text-emerald-300">{diag.configValue}</code>
            </p>
          )}
          <p className="text-[11px] text-white/30">Phân tích bởi {diag.model}</p>
        </div>
      )}
    </Card>
  );
}
