import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Nạp .env ở GỐC repo vào process.env (Next mặc định chỉ đọc .env trong apps/web).
// Nhờ vậy NEXT_PUBLIC_API_URL đặt 1 chỗ ở root .env là đủ cho cả build lẫn runtime.
// Ưu tiên: biến đã có trong môi trường / apps/web/.env* KHÔNG bị ghi đè.
const rootEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../.env');
try {
  for (const line of readFileSync(rootEnvPath, 'utf8').split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
} catch {
  /* không có .env gốc (vd CI) → bỏ qua */
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@deploybox/shared'],
};

export default nextConfig;
