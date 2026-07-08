import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET phải >= 8 ký tự'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  // Nếu đặt: chỉ ai có mã này mới đăng ký được (cho instance nội bộ). Rỗng = mở.
  SIGNUP_CODE: z.string().default(''),
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY phải >= 32 ký tự'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  APP_DOMAIN: z.string().default('localhost'),
  // Để trống = không dùng Redis (build chạy thẳng, không queue)
  REDIS_URL: z.string().default(''),
  BUILD_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),
  DATA_DIR: z.string().default('.deploybox-data'),
  PUBLIC_API_URL: z.string().default('http://localhost:4000'),
  CADDY_ADMIN_URL: z.string().default('http://localhost:2019'),
  PROXY_PORT: z.string().default('8080'),
  SLEEP_IDLE_SECONDS: z.coerce.number().default(120),
  SLEEP_SWEEP_SECONDS: z.coerce.number().default(30),
  // Production: bật HTTPS thật (Let's Encrypt) khi chạy trên VPS + domain thật
  PUBLIC_TLS: z.string().default('false'),
  ACME_EMAIL: z.string().default(''),
  WEB_UPSTREAM: z.string().default('localhost:3000'),
  API_UPSTREAM: z.string().default('localhost:4000'),
  // Thông báo deploy qua Telegram (tùy chọn). Có cả 2 = bật; để trống = tắt.
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_CHAT_ID: z.string().default(''),
  // AI "bác sĩ lỗi deploy". API key cho từng nhà cung cấp (có key nào = dùng được nhà đó).
  ANTHROPIC_API_KEY: z.string().default(''), // Claude
  OPENAI_API_KEY: z.string().default(''), // ChatGPT
  GEMINI_API_KEY: z.string().default(''), // Google Gemini
  // Provider + model mặc định lúc chưa cấu hình trong DB (admin đổi sau ở trang Admin).
  AI_MODEL: z.string().default('claude-opus-4-8'),
  // Gửi email (OTP đăng ký, quên mật khẩu). Gmail: SMTP_USER = địa chỉ Gmail,
  // SMTP_PASS = App Password (myaccount.google.com/apppasswords). Trống = tắt email.
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  MAIL_FROM: z.string().default(''), // vd: "DeployBox <bot@gmail.com>" — trống = dùng SMTP_USER
  // OAuth "Đăng nhập với GitHub/GitLab/Bitbucket" (tuỳ chọn — xem docs/deploy/oauth-setup.md)
  // Callback URL = <PUBLIC_API_URL>/api/v1/auth/oauth/<nhà>/callback. Trống = tắt nhà đó.
  GITHUB_OAUTH_CLIENT_ID: z.string().default(''),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().default(''),
  GITLAB_OAUTH_CLIENT_ID: z.string().default(''),
  GITLAB_OAUTH_CLIENT_SECRET: z.string().default(''),
  GITLAB_OAUTH_BASE_URL: z.string().default('https://gitlab.com'), // đổi nếu GitLab self-host
  BITBUCKET_OAUTH_CLIENT_ID: z.string().default(''),
  BITBUCKET_OAUTH_CLIENT_SECRET: z.string().default(''),
  // URL web công khai để OAuth redirect về. Trống = tự suy (PUBLIC_TLS ? https://APP_DOMAIN : http://localhost:3000)
  PUBLIC_WEB_URL: z.string().default(''),
  // ─── Thanh toán / nâng cấp PRO ──────────────────────────────────────────
  PRO_PRICE_VND: z.coerce.number().int().positive().default(99000), // giá 1 tháng
  PAYMENT_PROVIDER_DEFAULT: z.string().default('sepay'), // cổng mặc định khi checkout
  // SePay — chuyển khoản VietQR (đọc biến động số dư TK ngân hàng). Trống = tắt.
  SEPAY_ACCOUNT: z.string().default(''), // số tài khoản nhận tiền
  SEPAY_BANK: z.string().default(''), // mã ngân hàng (vd TPBank, VCB, ACB…)
  SEPAY_HOLDER: z.string().default(''), // tên chủ TK (chỉ để hiển thị)
  SEPAY_QR_BASE: z.string().default('https://qr.sepay.vn/img'), // API sinh ảnh VietQR
  SEPAY_WEBHOOK_APIKEY: z.string().default(''), // key xác thực webhook SePay gửi về
  // VNPay — điền sau khi đăng ký merchant (xem docs/deploy/payment-vnpay.md). Trống = tắt.
  VNPAY_TMN_CODE: z.string().default(''),
  VNPAY_HASH_SECRET: z.string().default(''),
  VNPAY_PAY_URL: z.string().default('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'),
  VNPAY_RETURN_URL: z.string().default(''), // URL web nhận khách quay về sau khi trả
});

export type AppEnv = z.infer<typeof envSchema>;

/** Validate biến môi trường lúc khởi động (dùng cho @nestjs/config). */
export function validateEnv(config: Record<string, unknown>): AppEnv {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const errors = JSON.stringify(parsed.error.flatten().fieldErrors, null, 2);
    throw new Error(`Cấu hình .env không hợp lệ:\n${errors}`);
  }
  return parsed.data;
}
