'use client';

import { useEffect, useState } from 'react';

interface Stats {
  cpu: string;
  mem: string;
  memPerc: string;
}

const MAX_POINTS = 30;

function parsePerc(s: string): number {
  return parseFloat(s.replace('%', '')) || 0;
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const W = 80, H = 28;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - (v / max) * H;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={W} height={H} className="opacity-70">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function MetricsCard({ projectId }: { projectId: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState(false);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [memHistory, setMemHistory] = useState<number[]>([]);

  useEffect(() => {
    let alive = true;

    const poll = async () => {
      try {
        const res = await fetch(`/api/metrics/${projectId}`);
        if (!res.ok) { setError(true); return; }
        const data = (await res.json()) as Stats | null;
        if (!alive || !data) return;
        setStats(data);
        setError(false);
        setCpuHistory((prev) => [...prev.slice(-(MAX_POINTS - 1)), parsePerc(data.cpu)]);
        setMemHistory((prev) => [...prev.slice(-(MAX_POINTS - 1)), parsePerc(data.memPerc)]);
      } catch {
        if (alive) setError(true);
      }
    };

    void poll();
    const id = setInterval(() => { void poll(); }, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [projectId]);

  if (error || stats === null) return null;

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-6">
        <span className="text-white/40">Container</span>
        <div className="flex items-center gap-2">
          <div>
            <span className="text-white/50 text-xs">CPU</span>
            <p className="font-mono text-emerald-300">{stats.cpu}</p>
          </div>
          <Sparkline data={cpuHistory} color="#6ee7b7" />
        </div>
        <div className="flex items-center gap-2">
          <div>
            <span className="text-white/50 text-xs">RAM</span>
            <p className="font-mono text-emerald-300">{stats.mem} <span className="text-white/40 text-xs">({stats.memPerc})</span></p>
          </div>
          <Sparkline data={memHistory} color="#93c5fd" />
        </div>
      </div>
    </div>
  );
}
