'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { CronJobDto } from '@deploybox/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  createCronAction,
  deleteCronAction,
  runCronAction,
  toggleCronAction,
} from './cron-actions';

const PRESETS = [
  { label: 'Mỗi giờ', value: '0 * * * *' },
  { label: '3h sáng hằng ngày', value: '0 3 * * *' },
  { label: 'Mỗi 15 phút', value: '*/15 * * * *' },
  { label: 'Thứ 2 hằng tuần 9h', value: '0 9 * * 1' },
];

export function CronPanel({
  projectId,
  initial,
}: {
  projectId: string;
  initial: CronJobDto[];
}) {
  const router = useRouter();
  const [jobs, setJobs] = useState<CronJobDto[]>(initial);
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('0 3 * * *');
  const [command, setCommand] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  function refresh() {
    router.refresh();
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const res = await createCronAction(projectId, { name, schedule, command });
      if (res.ok && res.data) {
        setJobs((j) => [...j, res.data!]);
        setName('');
        setCommand('');
      } else if (!res.ok) setErr(res.error);
    });
  }

  function toggle(job: CronJobDto) {
    setBusy(job.id);
    start(async () => {
      await toggleCronAction(projectId, job.id, !job.enabled);
      setJobs((js) => js.map((j) => (j.id === job.id ? { ...j, enabled: !j.enabled } : j)));
      setBusy(null);
    });
  }

  function run(job: CronJobDto) {
    setBusy(job.id);
    setErr(null);
    start(async () => {
      const res = await runCronAction(projectId, job.id);
      setBusy(null);
      if (res.ok && res.data) setJobs((js) => js.map((j) => (j.id === job.id ? res.data! : j)));
      else if (!res.ok) setErr(res.error);
    });
  }

  function del(job: CronJobDto) {
    if (!confirm(`Xoá cron "${job.name}"?`)) return;
    setBusy(job.id);
    start(async () => {
      await deleteCronAction(projectId, job.id);
      setJobs((js) => js.filter((j) => j.id !== job.id));
      setBusy(null);
      refresh();
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-white/40">
        Chạy 1 lệnh định kỳ trong app (theo giờ server). Vd migrate, dọn dữ liệu, gọi endpoint cron.
      </p>

      {/* Danh sách */}
      {jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map((j) => (
            <div
              key={j.id}
              className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-medium text-white/85">{j.name}</span>
                  <code className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-sky-300">
                    {j.schedule}
                  </code>
                  {!j.enabled && (
                    <span className="ml-2 text-[11px] text-white/30">(đang tắt)</span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => run(j)}
                    disabled={pending && busy === j.id}
                    className="text-xs text-emerald-400 hover:underline disabled:opacity-40"
                  >
                    {busy === j.id ? '…' : 'Chạy ngay'}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggle(j)}
                    disabled={pending && busy === j.id}
                    className="text-xs text-white/50 hover:underline disabled:opacity-40"
                  >
                    {j.enabled ? 'Tắt' : 'Bật'}
                  </button>
                  <button
                    type="button"
                    onClick={() => del(j)}
                    disabled={pending && busy === j.id}
                    className="text-xs text-red-400 hover:underline disabled:opacity-40"
                  >
                    Xoá
                  </button>
                </div>
              </div>
              <code className="mt-1 block truncate text-[11px] text-white/40">$ {j.command}</code>
              {j.lastRunAt && (
                <p className="mt-1 text-[11px]">
                  <span
                    className={j.lastStatus === 'success' ? 'text-emerald-400' : 'text-red-400'}
                  >
                    {j.lastStatus === 'success' ? '✓' : '✗'} {j.lastStatus}
                  </span>
                  <span className="text-white/30">
                    {' '}· {new Date(j.lastRunAt).toLocaleString('vi-VN')}
                  </span>
                </p>
              )}
              {j.lastOutput && (
                <pre className="mt-1 max-h-32 overflow-auto rounded bg-black/40 p-2 text-[11px] text-white/60">
                  {j.lastOutput}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Thêm mới */}
      <form onSubmit={add} className="space-y-2 rounded-lg border border-white/10 p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor="cronName">Tên</Label>
            <Input
              id="cronName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dọn dữ liệu cũ"
              required
            />
          </div>
          <div>
            <Label htmlFor="cronSchedule">Lịch (cron)</Label>
            <Input
              id="cronSchedule"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="0 3 * * *"
              required
            />
            <div className="mt-1 flex flex-wrap gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setSchedule(p.value)}
                  className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/50 hover:bg-white/10"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <Label htmlFor="cronCommand">Lệnh</Label>
          <Input
            id="cronCommand"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="node scripts/cleanup.js"
            required
          />
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <Button type="submit" disabled={pending || !name || !command}>
          {pending ? 'Đang lưu…' : 'Thêm cron'}
        </Button>
      </form>
    </div>
  );
}
