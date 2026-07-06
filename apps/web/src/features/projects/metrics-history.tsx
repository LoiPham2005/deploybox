'use client';

import { useEffect, useMemo, useState } from 'react';
import type { MetricPointDto } from '@deploybox/shared';

// Màu series đã validate (dataviz, dark surface): CPU xanh dương, RAM tím.
const CPU_COLOR = '#0284c7';
const MEM_COLOR = '#7c3aed';

const RANGES = [
  { label: '1 giờ', hours: 1 },
  { label: '24 giờ', hours: 24 },
  { label: '7 ngày', hours: 168 },
] as const;

function fmtTime(iso: string, hours: number): string {
  const d = new Date(iso);
  return hours > 24
    ? d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) +
        ' ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })
    : d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** 1 biểu đồ đường 1 series: grid chìm, đường 2px, hover crosshair + tooltip. */
function LineChart({
  points,
  color,
  unit,
  hours,
  decimals = 0,
}: {
  points: { at: string; v: number }[];
  color: string;
  unit: string;
  hours: number;
  decimals?: number;
}) {
  const [hover, setHover] = useState<number | null>(null); // index điểm gần chuột
  const W = 640;
  const H = 120;
  const PAD_L = 44;
  const PAD_B = 18;
  const PAD_T = 8;

  const { path, area, xOf, yOf, yTicks, xTicks } = useMemo(() => {
    const vs = points.map((p) => p.v);
    const max = Math.max(...vs, 1) * 1.15; // headroom
    const xOf = (i: number) =>
      PAD_L + (points.length < 2 ? 0 : (i / (points.length - 1)) * (W - PAD_L - 4));
    const yOf = (v: number) => PAD_T + (1 - v / max) * (H - PAD_T - PAD_B);
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(i)},${yOf(p.v)}`).join(' ');
    const area = points.length
      ? `${path} L${xOf(points.length - 1)},${H - PAD_B} L${xOf(0)},${H - PAD_B} Z`
      : '';
    // 3 mốc trục y (0, giữa, max thô)
    const yTicks = [0, max / 2, max].map((v) => ({ v, y: yOf(v) }));
    // ~4 mốc thời gian trục x
    const n = points.length;
    const xTicks = n >= 2
      ? [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1].map((i) => ({ i, x: xOf(i) }))
      : [];
    return { path, area, xOf, yOf, yTicks, xTicks };
  }, [points]);

  if (points.length < 2) {
    return (
      <p className="py-6 text-center text-xs text-white/30">
        Chưa đủ dữ liệu — mẫu ghi mỗi phút khi app đang chạy.
      </p>
    );
  }

  const hv = hover != null ? points[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const frac = (px - PAD_L) / (W - PAD_L - 4);
          const i = Math.round(frac * (points.length - 1));
          setHover(Math.min(points.length - 1, Math.max(0, i)));
        }}
      >
        {/* grid ngang chìm + nhãn y */}
        {yTicks.map((t) => (
          <g key={t.v}>
            <line x1={PAD_L} x2={W - 4} y1={t.y} y2={t.y} stroke="rgba(255,255,255,0.06)" />
            <text x={PAD_L - 6} y={t.y + 3} textAnchor="end" fontSize="9" fill="rgba(255,255,255,0.35)">
              {t.v >= 1000 ? `${(t.v / 1024).toFixed(1)}G` : t.v.toFixed(t.v < 10 && t.v > 0 ? 1 : 0)}
            </text>
          </g>
        ))}
        {/* nhãn thời gian trục x */}
        {xTicks.map((t) => (
          <text key={t.i} x={t.x} y={H - 4} textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.35)">
            {fmtTime(points[t.i].at, hours)}
          </text>
        ))}
        {/* vùng mờ + đường 2px */}
        <path d={area} fill={color} opacity="0.08" />
        <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {/* hover: crosshair + chấm */}
        {hv && hover != null && (
          <g>
            <line x1={xOf(hover)} x2={xOf(hover)} y1={PAD_T} y2={H - PAD_B} stroke="rgba(255,255,255,0.2)" />
            <circle cx={xOf(hover)} cy={yOf(hv.v)} r="3.5" fill={color} stroke="#0b0d12" strokeWidth="1.5" />
          </g>
        )}
      </svg>
      {hv && (
        <div className="pointer-events-none absolute right-1 top-0 rounded bg-black/70 px-2 py-1 text-[11px] text-white/85">
          {fmtTime(hv.at, hours)} · <b>{hv.v.toFixed(decimals)}{unit}</b>
        </div>
      )}
    </div>
  );
}

export function MetricsHistory({
  projectId,
  initial,
}: {
  projectId: string;
  initial: MetricPointDto[];
}) {
  const [hours, setHours] = useState<number>(24);
  const [data, setData] = useState<MetricPointDto[]>(initial);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (hours === 24 && data === initial) return; // giữ dữ liệu server render sẵn
    let alive = true;
    setLoading(true);
    fetch(`/api/metrics-history/${projectId}?hours=${hours}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: MetricPointDto[]) => { if (alive) setData(Array.isArray(d) ? d : []); })
      .catch(() => { if (alive) setData([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours, projectId]);

  const cpu = data.filter((p) => p.cpuPct != null).map((p) => ({ at: p.at, v: p.cpuPct as number }));
  const mem = data.map((p) => ({ at: p.at, v: p.memMb }));
  const last = data[data.length - 1];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-white/40">
          Mẫu mỗi phút khi app chạy, giữ 7 ngày.
          {last && (
            <span className="ml-2 text-white/60">
              Hiện tại: {last.cpuPct != null ? `${last.cpuPct.toFixed(1)}% CPU · ` : ''}
              {last.memMb.toFixed(0)} MB RAM
            </span>
          )}
        </p>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.hours}
              type="button"
              onClick={() => setHours(r.hours)}
              className={`rounded px-2 py-0.5 text-[11px] ${
                hours === r.hours
                  ? 'bg-white/10 text-white/85'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className={loading ? 'opacity-50' : ''}>
        <p className="mb-1 text-[11px] font-medium" style={{ color: CPU_COLOR }}>
          ● <span className="text-white/60">CPU (%)</span>
        </p>
        <LineChart points={cpu} color={CPU_COLOR} unit="%" hours={hours} decimals={1} />
        <p className="mb-1 mt-3 text-[11px] font-medium" style={{ color: MEM_COLOR }}>
          ● <span className="text-white/60">RAM (MB)</span>
        </p>
        <LineChart points={mem} color={MEM_COLOR} unit=" MB" hours={hours} />
      </div>
    </div>
  );
}
