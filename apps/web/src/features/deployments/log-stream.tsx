'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  deploymentId: string;
  initialLogs: string;
  isActive: boolean;
}

export function LogStream({ deploymentId, initialLogs, isActive }: Props) {
  const [lines, setLines] = useState<string[]>(() =>
    isActive ? [] : (initialLogs ? initialLogs.split('\n').filter(Boolean) : []),
  );
  const [streaming, setStreaming] = useState(isActive);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  useEffect(() => {
    if (!isActive) return;

    const es = new EventSource(`/api/stream/${deploymentId}`);

    es.addEventListener('log', (e: MessageEvent<string>) => {
      const line = JSON.parse(e.data) as string;
      setLines((prev) => [...prev, line]);
    });

    es.addEventListener('done', () => {
      setStreaming(false);
      es.close();
    });

    es.onerror = () => {
      setStreaming(false);
      es.close();
    };

    return () => es.close();
  }, [deploymentId, isActive]);

  // Auto-scroll khi có log mới, trừ khi user đã cuộn lên
  useEffect(() => {
    if (autoScroll.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    }
  }, [lines]);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="max-h-[32rem] overflow-auto rounded bg-black/50 p-3 font-mono text-xs leading-relaxed"
    >
      {lines.length === 0 && streaming && (
        <span className="text-white/30">Đang chờ log…</span>
      )}
      {lines.map((line, i) => (
        <div key={i} className={`whitespace-pre-wrap ${line.startsWith('===') ? 'text-emerald-400 font-semibold' : line.includes('LỖI') || line.includes('ERROR') || line.includes('error') ? 'text-red-400' : 'text-white/80'}`}>
          {line}
        </div>
      ))}
      {streaming && (
        <span className="inline-block animate-pulse text-white/30">▌</span>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
