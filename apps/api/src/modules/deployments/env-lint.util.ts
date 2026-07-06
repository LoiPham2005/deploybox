/**
 * 🔎 Lint env trước khi deploy — bắt đúng các lỗi "copy .env local lên production"
 * đã gặp thật: URL thiếu scheme (new URL nổ), ngrok/tunnel tạm, localhost trong
 * biến public-facing. CHỈ cảnh báo, không chặn deploy.
 *
 * Lưu ý false-positive: localhost là HỢP LỆ cho biến server-nội-bộ trên host-run
 * (REDIS_HOST, DATABASE_URL trỏ db 1-click…) → chỉ soi biến trông "public".
 */

export interface EnvLintWarning {
  key: string;
  issue: string;
}

// Biến mà TRÌNH DUYỆT / dịch vụ NGOÀI sẽ dùng giá trị → localhost/http là sai thật
const PUBLIC_KEY_RE =
  /^(NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_)|PUBLIC|CALLBACK|REDIRECT|WEBHOOK|FRONTEND|CORS|ORIGIN|(^|_)(WEB|APP|SITE|CLIENT|BASE)_?URL/i;

// Domain tunnel tạm thời — sống theo phiên dev, chết bất kỳ lúc nào
const TUNNEL_RE = /ngrok(-free)?\.(app|dev|io)|trycloudflare\.com|loca\.lt|serveo\.net|localtunnel/i;

// Key trông như chứa URL đầy đủ
const URLISH_KEY_RE = /(_URL|_URI|_BASE|_ENDPOINT|_HOST_URL)$/i;

export function lintEnvValues(env: Record<string, string>): EnvLintWarning[] {
  const warns: EnvLintWarning[] = [];
  for (const [key, value] of Object.entries(env)) {
    const v = (value ?? '').trim();
    if (!v) continue;

    if (TUNNEL_RE.test(v)) {
      warns.push({ key, issue: `trỏ URL tunnel tạm (${v.slice(0, 40)}…) — sẽ chết khi bạn tắt máy dev` });
      continue;
    }
    if (URLISH_KEY_RE.test(key) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(v) && !v.startsWith('/')) {
      warns.push({ key, issue: `thiếu scheme (https://…) — code chạy new URL("${v.slice(0, 30)}") sẽ lỗi Invalid URL` });
      continue;
    }
    if (PUBLIC_KEY_RE.test(key)) {
      if (/localhost|127\.0\.0\.1/i.test(v)) {
        warns.push({ key, issue: 'trỏ localhost — trình duyệt/dịch vụ ngoài không thấy máy dev của bạn' });
      } else if (/^http:\/\//i.test(v)) {
        warns.push({ key, issue: 'dùng http:// — app validate https hoặc trình duyệt chặn mixed-content' });
      }
    }
  }
  return warns;
}
