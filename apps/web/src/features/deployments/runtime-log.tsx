'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  deploymentId: string;
}

export function RuntimeLog({ deploymentId }: Props) {
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [active, setActive] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  const start = () => {
    if (esRef.current) return;
    setLines([]);
    setConnected(true);
    setActive(true);

    const es = new EventSource(`/api/stream/${deploymentId}?type=runtime`);
    esRef.current = es;

    es.addEventListener('log', (e: MessageEvent<string>) => {
      const line = JSON.parse(e.data) as string;
      setLines((prev) => [...prev.slice(-500), line]); // giữ tối đa 500 dòng
    });

    es.addEventListener('error', () => {
      setConnected(false);
    });
  };

  const stop = () => {
    esRef.current?.close();
    esRef.current = null;
    setActive(false);
    setConnected(false);
  };

  useEffect(() => () => { esRef.current?.close(); }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [lines]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-white/70">Runtime log</h2>
        {active ? (
          <button
            onClick={stop}
            className="rounded bg-red-600/20 px-2 py-0.5 text-xs text-red-400 hover:bg-red-600/40"
          >
            Dừng
          </button>
        ) : (
          <button
            onClick={start}
            className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/60 hover:bg-white/20"
          >
            Xem log container
          </button>
        )}
        {connected && (
          <span className="flex items-center gap-1 text-xs text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            live
          </span>
        )}
      </div>

      {active && (
        <div className="max-h-72 overflow-auto rounded bg-black/50 p-3 font-mono text-xs leading-relaxed">
          {lines.length === 0 && <span className="text-white/30">Đang chờ log container…</span>}
          {lines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap text-white/75">{line}</div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
