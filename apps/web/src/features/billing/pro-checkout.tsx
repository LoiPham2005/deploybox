'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CheckoutResponse } from '@deploybox/shared';
import { Button } from '@/components/ui/button';
import { checkoutAction, getOrderAction, refreshBillingAction } from './actions';

const MONTHS = [
  { m: 1, label: '1 tháng' },
  { m: 3, label: '3 tháng' },
  { m: 6, label: '6 tháng' },
  { m: 12, label: '12 tháng' },
];

const fmt = (n: number) => n.toLocaleString('vi-VN');

export function ProCheckout({
  teamId,
  priceVnd,
}: {
  teamId: string;
  priceVnd: number;
}) {
  const router = useRouter();
  const [months, setMonths] = useState(1);
  const [order, setOrder] = useState<CheckoutResponse | null>(null);
  const [status, setStatus] = useState<'idle' | 'pending' | 'paid'>('idle');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function buy() {
    setLoading(true);
    setErr(null);
    const res = await checkoutAction(teamId, months);
    setLoading(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    if (res.data.redirectUrl) {
      // Cổng redirect (VNPay…) → điều hướng sang trang trả tiền
      window.location.href = res.data.redirectUrl;
      return;
    }
    setOrder(res.data);
    setStatus('pending');
  }

  // Poll trạng thái đơn khi đang chờ chuyển khoản
  useEffect(() => {
    if (status !== 'pending' || !order) return;
    pollRef.current = setInterval(() => {
      void getOrderAction(order.orderCode).then(async (r) => {
        if (r.ok && r.data.status === 'PAID') {
          setStatus('paid');
          if (pollRef.current) clearInterval(pollRef.current);
          await refreshBillingAction();
          router.refresh();
        }
      });
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [status, order, router]);

  function copyContent() {
    if (!order) return;
    void navigator.clipboard.writeText(order.transferContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function reset() {
    if (pollRef.current) clearInterval(pollRef.current);
    setOrder(null);
    setStatus('idle');
    setErr(null);
  }

  if (status === 'paid') {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
        ✓ Thanh toán thành công — gói đã lên <b>PRO</b>. Đang cập nhật…
      </div>
    );
  }

  if (order && status === 'pending') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-white/60">
          Quét mã bằng app ngân hàng để chuyển khoản. Hệ thống tự kích hoạt PRO
          sau khi nhận tiền (thường vài giây).
        </p>
        <div className="flex flex-col items-center gap-4 rounded-lg border border-white/[0.08] bg-white/5 p-4 sm:flex-row sm:items-start">
          {order.qrUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={order.qrUrl}
              alt="VietQR"
              width={200}
              height={200}
              className="rounded-md bg-white p-2"
            />
          )}
          <div className="flex-1 space-y-1.5 text-sm">
            <Row label="Ngân hàng" value={order.bankName} />
            <Row label="Số tài khoản" value={order.bankAccount} />
            <Row label="Chủ TK" value={order.holder} />
            <Row label="Số tiền" value={`${fmt(order.amount)}₫`} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-white/40">Nội dung CK</span>
              <span className="flex items-center gap-2">
                <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-indigo-300">
                  {order.transferContent}
                </code>
                <button
                  type="button"
                  onClick={copyContent}
                  className="text-xs text-indigo-400 hover:underline"
                >
                  {copied ? 'Đã copy' : 'Copy'}
                </button>
              </span>
            </div>
            <p className="pt-1 text-[11px] text-amber-300/80">
              ⚠️ Chuyển ĐÚNG nội dung{' '}
              <b>{order.transferContent}</b> để tự động kích hoạt.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 text-xs text-white/50">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-indigo-400" />
            Đang chờ thanh toán…
          </span>
          <button
            type="button"
            onClick={reset}
            className="text-xs text-white/40 hover:underline"
          >
            Huỷ / tạo đơn khác
          </button>
        </div>
      </div>
    );
  }

  // idle
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {MONTHS.map(({ m, label }) => (
          <button
            key={m}
            type="button"
            onClick={() => setMonths(m)}
            className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
              months === m
                ? 'border-indigo-400 bg-indigo-500/15 text-white'
                : 'border-white/10 text-white/50 hover:border-white/30'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold">{fmt(priceVnd * months)}₫</span>
        <span className="text-xs text-white/40">cho {months} tháng</span>
      </div>
      <Button onClick={buy} disabled={loading}>
        {loading ? 'Đang tạo đơn…' : 'Mua Pro — chuyển khoản QR'}
      </Button>
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-white/40">{label}</span>
      <span className="font-medium">{value || '—'}</span>
    </div>
  );
}
