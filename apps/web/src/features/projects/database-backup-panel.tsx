'use client';

import { useEffect, useState } from 'react';
import { Download, Trash2, RefreshCw } from 'lucide-react';
import type { BackupDto, BackupStatsDto } from '@deploybox/shared';
import {
  getBackupDataAction,
  backupNowAction,
  deleteBackupAction,
  getDownloadUrlAction,
  setAutoBackupAction,
} from './backup-actions';

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-white/35">{label}</p>
      <div className="mt-1 text-sm font-semibold text-white/85">{children}</div>
    </div>
  );
}

export function DatabaseBackupPanel({
  projectId,
  dbId,
  dbName,
}: {
  projectId: string;
  dbId: string;
  dbName: string;
}) {
  const [stats, setStats] = useState<BackupStatsDto | null>(null);
  const [backups, setBackups] = useState<BackupDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const res = await getBackupDataAction(projectId, dbId);
    setLoading(false);
    if (res.ok) {
      setStats(res.data.stats);
      setBackups(res.data.backups);
      setErr(null);
    } else setErr(res.error);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, dbId]);

  async function backupNow() {
    setRunning(true);
    setErr(null);
    const res = await backupNowAction(projectId, dbId);
    setRunning(false);
    if (res.ok) await load();
    else setErr(res.error);
  }

  async function toggleAuto() {
    if (!stats) return;
    const next = !stats.autoEnabled;
    setStats({ ...stats, autoEnabled: next });
    const res = await setAutoBackupAction(projectId, dbId, next);
    if (!res.ok) {
      setErr(res.error ?? 'Đổi chế độ thất bại');
      setStats({ ...stats, autoEnabled: !next });
    }
  }

  async function download(b: BackupDto) {
    setBusy(b.id);
    const res = await getDownloadUrlAction(projectId, dbId, b.id);
    setBusy(null);
    if (res.ok) window.open(res.data, '_blank');
    else setErr(res.error);
  }

  async function del(b: BackupDto) {
    if (!confirm(`Xoá bản sao lưu ${b.filename}?`)) return;
    setBusy(b.id);
    const res = await deleteBackupAction(projectId, dbId, b.id);
    setBusy(null);
    if (res.ok) setBackups((x) => x.filter((y) => y.id !== b.id));
    else setErr(res.error ?? 'Xoá thất bại');
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-white/90">Dữ liệu &amp; Sao lưu ({dbName})</h3>
          <p className="text-xs text-white/40">
            {stats?.configured
              ? `Lưu an toàn trên ${stats.destinationText}`
              : 'Chưa cấu hình nơi lưu — Admin → Sao lưu'}
          </p>
        </div>
        <button
          type="button"
          onClick={backupNow}
          disabled={running || !stats?.configured}
          className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          <RefreshCw size={14} className={running ? 'animate-spin' : ''} />
          {running ? 'Đang sao lưu…' : 'Sao Lưu Ngay'}
        </button>
      </div>

      {/* 4 thẻ thống kê */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Trạng thái tự động">
          <button type="button" onClick={toggleAuto} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${stats?.autoEnabled ? 'bg-emerald-400' : 'bg-white/30'}`} />
            {stats?.autoEnabled ? 'Đang bật' : 'Đang tắt'}
            <span className="text-[10px] text-indigo-400">(đổi)</span>
          </button>
        </Stat>
        <Stat label="Lịch sao lưu">{stats?.scheduleText ?? '—'}</Stat>
        <Stat label="Thời gian giữ">{stats ? `${stats.retentionDays} ngày gần nhất` : '—'}</Stat>
        <Stat label="Tổng số bản">{stats?.total ?? 0} bản</Stat>
      </div>

      {err && <p className="text-xs text-red-400">{err}</p>}

      {/* Bảng lịch sử */}
      <div className="overflow-hidden rounded-lg border border-white/[0.07]">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
          <p className="text-xs font-semibold text-white/60">Lịch sử các bản sao lưu</p>
          <span className="text-[11px] text-white/30">mỗi dòng là 1 lần sao lưu</span>
        </div>
        {loading ? (
          <p className="px-3 py-6 text-center text-xs text-white/40">Đang tải…</p>
        ) : backups.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-white/40">
            Chưa có bản sao lưu nào. Nhấn “Sao Lưu Ngay”.
          </p>
        ) : (
          <div className="max-h-80 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase text-white/35">
                  <th className="px-3 py-2 font-medium">STT</th>
                  <th className="px-3 py-2 font-medium">Thời gian</th>
                  <th className="px-3 py-2 font-medium">Tên file</th>
                  <th className="px-3 py-2 font-medium">Dung lượng</th>
                  <th className="px-3 py-2 text-right font-medium">Hành động</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b, i) => (
                  <tr key={b.id} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-3 py-2 text-white/40">{i + 1}</td>
                    <td className="px-3 py-2">
                      <div className="text-white/80">
                        {new Date(b.createdAt).toLocaleString('vi-VN')}
                      </div>
                      <div className="text-[11px] text-white/35">{ago(b.createdAt)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <code className="text-[11px] text-white/60">{b.filename}</code>
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/70">
                        {fmtSize(b.sizeBytes)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => download(b)}
                          disabled={busy === b.id}
                          className="flex items-center gap-1 rounded border border-emerald-500/30 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
                        >
                          <Download size={12} /> Tải về
                        </button>
                        <button
                          type="button"
                          onClick={() => del(b)}
                          disabled={busy === b.id}
                          className="flex items-center gap-1 rounded border border-red-500/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          <Trash2 size={12} /> Xoá
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-white/30">
        💡 File tải về là dump <code>.sql</code> nén <code>.gz</code>. Giải nén:{' '}
        <code>gunzip tên_file.gz</code>. Khôi phục: nạp file .sql vào DB (psql / mysql).
      </p>
    </div>
  );
}
