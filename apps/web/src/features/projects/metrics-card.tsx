'use client';

import { useEffect, useState } from 'react';

interface Stats {
  cpu: string;
  mem: string;
  memPerc: string;
}

export function MetricsCard({ projectId }: { projectId: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;

    const poll = async () => {
      try {
        const res = await fetch(`/api/metrics/${projectId}`);
        if (!res.ok) { setError(true); return; }
        const data = (await res.json()) as Stats | null;
        if (alive) { setStats(data); setError(false); }
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
    <div className="flex gap-4 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm">
      <span className="text-white/40">Container</span>
      <span className="text-white/80">
        CPU <span className="font-mono text-emerald-300">{stats.cpu}</span>
      </span>
      <span className="text-white/80">
        RAM <span className="font-mono text-emerald-300">{stats.mem}</span>{' '}
        <span className="text-white/40">({stats.memPerc})</span>
      </span>
    </div>
  );
}
