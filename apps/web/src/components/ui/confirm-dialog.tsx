'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './button';

export interface ConfirmOptions {
  title: string;
  /** Nội dung phụ — string hoặc JSX (vd khối <code> hiển thị giá trị config). */
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** true = hành động nguy hiểm (nút đỏ): xóa, thu hồi… */
  danger?: boolean;
}

interface DialogState extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

/**
 * Hộp xác nhận dùng chung, thay confirm() mặc định của trình duyệt.
 *
 * const { confirm, dialog } = useConfirm();
 * ...
 * if (!(await confirm({ title: 'Xóa project?', danger: true }))) return;
 * ...
 * return (<>{dialog} ...UI...</>);
 */
export function useConfirm() {
  const [state, setState] = useState<DialogState | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => setState({ ...opts, resolve }));
  }, []);

  const close = useCallback(
    (ok: boolean) => {
      state?.resolve(ok);
      setState(null);
    },
    [state],
  );

  const dialog = state ? <ConfirmDialog state={state} onClose={close} /> : null;
  return { confirm, dialog };
}

function ConfirmDialog({
  state,
  onClose,
}: {
  state: DialogState;
  onClose: (ok: boolean) => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(false);
      if (e.key === 'Enter') onClose(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={state.title}
    >
      <style>{`
        @keyframes cd-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes cd-pop { from { opacity: 0; transform: translateY(8px) scale(.97) } to { opacity: 1; transform: none } }
      `}</style>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        style={{ animation: 'cd-fade .15s ease-out' }}
        onClick={() => onClose(false)}
      />
      {/* Panel */}
      <div
        className="relative w-full max-w-md rounded-2xl border border-white/[0.06] bg-[#12151c] p-5 shadow-2xl shadow-black/50"
        style={{ animation: 'cd-pop .18s ease-out' }}
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base ${
              state.danger ? 'bg-red-500/15 text-red-400' : 'bg-sky-500/15 text-sky-300'
            }`}
          >
            {state.danger ? '⚠️' : '✦'}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-white/90">{state.title}</h3>
            {state.message && (
              <div className="mt-2 text-sm leading-relaxed text-white/60">
                {state.message}
              </div>
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="ghost"
            className="px-3 py-1.5 text-sm text-white/60"
            onClick={() => onClose(false)}
          >
            {state.cancelText ?? 'Hủy'}
          </Button>
          <Button
            ref={confirmRef}
            className={`px-3 py-1.5 text-sm ${
              state.danger ? 'bg-red-600 hover:bg-red-500' : ''
            }`}
            onClick={() => onClose(true)}
          >
            {state.confirmText ?? 'Xác nhận'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
