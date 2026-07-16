import type { Metadata } from 'next';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { LogoMark } from '@/components/logo';
import { PLAN_LIMITS } from '@deploybox/shared';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'DeployBox — Deploy app của bạn trong 60 giây',
  description:
    'Nền tảng deploy tự động: đẩy code lên Git là app chạy — HTTPS + tên miền tự động, watchdog tự cứu app, AI chẩn đoán lỗi, backup 2 nơi. Thanh toán QR/MoMo/VNPay.',
};

const API_BASE =
  (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000') + '/api/v1';

const vnd = (n: number) => n.toLocaleString('vi-VN');

// ─── Nội dung ────────────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: '🚀',
    title: 'Git push là deploy',
    desc: 'Kết nối repo GitHub/GitLab — mỗi lần push, app tự build và lên sóng. Kèm preview riêng cho từng Pull Request.',
  },
  {
    icon: '🔒',
    title: 'HTTPS + tên miền tự động',
    desc: 'Mỗi app có ngay subdomain + SSL miễn phí. Gắn tên miền riêng của bạn chỉ với 1 record DNS.',
  },
  {
    icon: '🐕',
    title: 'Watchdog tự cứu app',
    desc: 'App crash được phát hiện và khởi động lại trong ≤60 giây, chống crash-loop, cảnh báo sớm qua Telegram.',
  },
  {
    icon: '🤖',
    title: 'AI chẩn đoán lỗi',
    desc: 'Deploy hỏng? AI đọc log, chỉ ra nguyên nhân và gợi ý cách sửa bằng tiếng Việt — bấm một nút để áp dụng.',
  },
  {
    icon: '🗄️',
    title: 'Database 1 cú nhấp',
    desc: 'PostgreSQL / MySQL / Redis tạo sẵn trong vài giây, tự đấu nối vào app, backup định kỳ.',
  },
  {
    icon: '📈',
    title: 'Giám sát CPU / RAM',
    desc: 'Biểu đồ tài nguyên theo thời gian, cảnh báo khi RAM vượt ngưỡng, trang trạng thái công khai.',
  },
  {
    icon: '😴',
    title: 'Ngủ thông minh',
    desc: 'App ít dùng tự "ngủ" để trả RAM cho máy — có người truy cập là tự thức dậy sau vài giây.',
  },
  {
    icon: '🖥️',
    title: 'Deploy lên server CỦA BẠN',
    desc: 'Có VPS riêng? Thêm qua SSH — code build và chạy ngay trên máy của bạn, vẫn quản lý một chỗ.',
  },
];

const STEPS = [
  {
    n: '1',
    title: 'Dán link Git repo',
    desc: 'Tạo project, dán link repo (hoặc đăng nhập GitHub chọn từ danh sách). DeployBox tự nhận diện cách build.',
  },
  {
    n: '2',
    title: 'Bấm Deploy',
    desc: 'Clone → build → health-check — bản mới hỏng thì bản cũ vẫn chạy, app không bao giờ sập vì deploy.',
  },
  {
    n: '3',
    title: 'App lên sóng',
    desc: 'Nhận ngay https://ten-app.sneakup.io.vn. Từ giờ chỉ cần git push là bản mới tự lên.',
  },
];

const TERMINAL_LINES: { text: string; cls: string }[] = [
  { text: '$ git push origin main', cls: 'text-white/70' },
  { text: '→ DeployBox nhận webhook — bắt đầu build…', cls: 'text-sky-300' },
  { text: '✓ npm install (12s)', cls: 'text-emerald-300' },
  { text: '✓ Build xong (34s)', cls: 'text-emerald-300' },
  { text: '🩺 Health-check: bản mới trả lời OK', cls: 'text-emerald-300' },
  { text: '🚀 Live: https://my-app.sneakup.io.vn', cls: 'text-indigo-300 font-semibold' },
];

export default async function LandingPage() {
  const loggedIn = !!getToken();

  // Giá + số app đang chạy — lấy sống từ API, hỏng thì dùng mặc định
  const [priceVnd, runningApps] = await Promise.all([
    fetch(`${API_BASE}/billing/pricing`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { priceVnd: number } | null) => d?.priceVnd ?? 99000)
      .catch(() => 99000),
    fetch(`${API_BASE}/public/status`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d: { services: { status: string }[] } | null) =>
          d?.services.filter((s) => s.status === 'RUNNING').length ?? null,
      )
      .catch(() => null),
  ]);

  const cta = loggedIn
    ? { href: '/dashboard', label: 'Vào Dashboard →' }
    : { href: '/register', label: 'Bắt đầu miễn phí →' };

  return (
    <div className="min-h-screen bg-[#09090b] text-white antialiased">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#09090b]/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2.5">
            <LogoMark size={26} className="rounded-md shadow-lg shadow-indigo-900/50" />
            <span className="text-sm font-bold tracking-tight">DeployBox</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-white/60 sm:flex">
            <a href="#features" className="hover:text-white">Tính năng</a>
            <a href="#pricing" className="hover:text-white">Bảng giá</a>
            <Link href="/status" className="hover:text-white">Trạng thái</Link>
          </nav>
          <div className="flex items-center gap-2">
            {!loggedIn && (
              <Link
                href="/login"
                className="rounded-md px-3 py-1.5 text-sm text-white/70 hover:text-white"
              >
                Đăng nhập
              </Link>
            )}
            <Link
              href={loggedIn ? '/dashboard' : '/register'}
              className="rounded-md bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-lg shadow-indigo-900/40 transition-colors hover:bg-indigo-500"
            >
              {loggedIn ? 'Dashboard' : 'Dùng thử miễn phí'}
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        {/* nền: lưới mờ + quầng sáng */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
            maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
          }}
        />
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-indigo-600/20 blur-[120px]" />

        <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-16 text-center sm:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3.5 py-1 text-xs font-medium text-indigo-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            Nền tảng deploy tự động — làm chủ hạ tầng của bạn
          </span>

          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">
            Deploy app của bạn{' '}
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
              trong 60 giây
            </span>
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-white/50 sm:text-lg">
            Đẩy code lên Git — DeployBox lo phần còn lại: build, HTTPS, tên miền,
            giám sát, tự cứu khi crash. Không cần biết DevOps, không cần cấu hình server.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href={cta.href}
              className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-xl shadow-indigo-900/50 transition-all hover:-translate-y-0.5 hover:bg-indigo-500"
            >
              {cta.label}
            </Link>
            <a
              href="#pricing"
              className="rounded-lg border border-white/10 bg-white/5 px-6 py-3 text-sm font-medium text-white/80 transition-colors hover:border-white/25 hover:text-white"
            >
              Xem bảng giá
            </a>
          </div>

          {/* Terminal mockup */}
          <div className="mx-auto mt-14 max-w-2xl overflow-hidden rounded-xl border border-white/10 bg-[#0d0d10] text-left shadow-2xl shadow-black/60">
            <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
              <span className="ml-3 text-[11px] text-white/30">deploybox — deploy log</span>
            </div>
            <div className="space-y-1.5 px-5 py-4 font-mono text-[13px]">
              {TERMINAL_LINES.map((l) => (
                <p key={l.text} className={l.cls}>{l.text}</p>
              ))}
            </div>
          </div>

          {/* Stats strip */}
          <div className="mx-auto mt-10 flex max-w-2xl flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm text-white/40">
            {runningApps !== null && runningApps > 0 && (
              <span>
                <b className="text-white/80">{runningApps}</b> app đang chạy
              </span>
            )}
            <span>Deploy ~<b className="text-white/80">60 giây</b></span>
            <span>HTTPS <b className="text-white/80">tự động</b></span>
            <span>Backup <b className="text-white/80">2 nơi</b></span>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="text-center text-3xl font-bold tracking-tight">
          Mọi thứ app của bạn cần, <span className="text-indigo-400">trong một chỗ</span>
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-white/45">
          Từ dòng code đến app chạy thật có người dùng — không phải mở terminal SSH lần nào.
        </p>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group rounded-xl border border-white/[0.07] bg-white/[0.02] p-5 transition-colors hover:border-indigo-400/30 hover:bg-indigo-500/[0.04]"
            >
              <div className="text-2xl">{f.icon}</div>
              <h3 className="mt-3 text-sm font-semibold text-white/90">{f.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-white/45">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="border-y border-white/[0.05] bg-white/[0.015]">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <h2 className="text-center text-3xl font-bold tracking-tight">
            Lên sóng trong <span className="text-indigo-400">3 bước</span>
          </h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="relative text-center sm:text-left">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500/15 text-sm font-bold text-indigo-300 sm:mx-0">
                  {s.n}
                </div>
                <h3 className="mt-4 text-base font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/45">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="text-center text-3xl font-bold tracking-tight">
          Giá <span className="text-indigo-400">đơn giản</span>, trả bằng QR
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-white/45">
          Bắt đầu miễn phí. Nâng cấp khi cần — thanh toán chuyển khoản QR, MoMo, ZaloPay, VNPay.
          Không tự động trừ tiền.
        </p>

        <div className="mx-auto mt-12 grid max-w-3xl gap-6 sm:grid-cols-2">
          {/* FREE */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-7">
            <h3 className="text-sm font-semibold text-white/70">FREE</h3>
            <p className="mt-3 text-4xl font-extrabold">0₫</p>
            <p className="mt-1 text-xs text-white/40">mãi mãi</p>
            <ul className="mt-6 space-y-2.5 text-sm text-white/70">
              <li>✓ {PLAN_LIMITS.FREE.projects} projects</li>
              <li>✓ {PLAN_LIMITS.FREE.servers} server</li>
              <li>✓ {PLAN_LIMITS.FREE.members} thành viên</li>
              <li>✓ HTTPS + subdomain tự động</li>
              <li>✓ Watchdog + giám sát cơ bản</li>
            </ul>
            <Link
              href={loggedIn ? '/dashboard' : '/register'}
              className="mt-7 block rounded-lg border border-white/15 py-2.5 text-center text-sm font-medium text-white/80 transition-colors hover:border-white/35 hover:text-white"
            >
              Bắt đầu miễn phí
            </Link>
          </div>

          {/* PRO */}
          <div className="relative rounded-2xl border border-indigo-400/40 bg-gradient-to-b from-indigo-500/[0.08] to-transparent p-7 shadow-xl shadow-indigo-950/40">
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-3 py-0.5 text-[11px] font-semibold">
              PHỔ BIẾN NHẤT
            </span>
            <h3 className="text-sm font-semibold text-indigo-300">PRO</h3>
            <p className="mt-3 text-4xl font-extrabold">
              {vnd(priceVnd)}₫
              <span className="text-sm font-normal text-white/40"> /tháng</span>
            </p>
            <p className="mt-1 text-xs text-white/40">mua 3/6/12 tháng — cộng dồn thời hạn</p>
            <ul className="mt-6 space-y-2.5 text-sm text-white/70">
              <li>✓ <b className="text-white">Không giới hạn</b> projects</li>
              <li>✓ <b className="text-white">Không giới hạn</b> servers (thêm VPS riêng)</li>
              <li>✓ <b className="text-white">Không giới hạn</b> thành viên team</li>
              <li>✓ AI chẩn đoán & sửa lỗi deploy</li>
              <li>✓ Ưu tiên hỗ trợ</li>
            </ul>
            <Link
              href={loggedIn ? '/settings/billing' : '/register'}
              className="mt-7 block rounded-lg bg-indigo-600 py-2.5 text-center text-sm font-semibold text-white shadow-lg shadow-indigo-900/50 transition-colors hover:bg-indigo-500"
            >
              Nâng cấp PRO
            </Link>
          </div>
        </div>
      </section>

      {/* ── CTA cuối ── */}
      <section className="relative overflow-hidden border-t border-white/[0.05]">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-indigo-600/10 blur-[100px]" />
        <div className="relative mx-auto max-w-3xl px-4 py-20 text-center">
          <h2 className="text-3xl font-bold tracking-tight">
            Sẵn sàng cho app đầu tiên lên sóng?
          </h2>
          <p className="mt-3 text-sm text-white/45">
            Tạo tài khoản, dán link repo — 60 giây sau bạn có link HTTPS để gửi cho cả thế giới.
          </p>
          <Link
            href={cta.href}
            className="mt-7 inline-block rounded-lg bg-indigo-600 px-8 py-3 text-sm font-semibold text-white shadow-xl shadow-indigo-900/50 transition-all hover:-translate-y-0.5 hover:bg-indigo-500"
          >
            {cta.label}
          </Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/[0.05]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-xs text-white/35 sm:flex-row">
          <div className="flex items-center gap-2">
            <LogoMark size={18} className="rounded" />
            <span>DeployBox · sneakup.io.vn</span>
          </div>
          <div className="flex items-center gap-5">
            <Link href="/status" className="hover:text-white/70">Trạng thái dịch vụ</Link>
            <Link href="/login" className="hover:text-white/70">Đăng nhập</Link>
            <Link href="/register" className="hover:text-white/70">Đăng ký</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
