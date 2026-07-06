/**
 * 🧭 Phân tích DETERMINISTIC repo (không cần AI) → chuỗi "gợi ý" bơm vào prompt
 * cho AI "Tự nhận diện cấu hình". AI giỏi tổng hợp nhưng hay đoán sai chi tiết
 * máy móc (lockfile nào, standalone hay export…) — phần đó code tự kết luận,
 * AI chỉ việc tin và điền phần còn lại.
 */

export function buildRepoHints(tree: string, files: Record<string, string>): string {
  const hints: string[] = [];
  const has = (name: string) => tree.split('\n').some((l) => l.trim().endsWith(name));
  const file = (suffix: string) =>
    Object.entries(files).find(([p]) => p === suffix || p.endsWith(`/${suffix}`))?.[1] ?? '';

  // 1) Package manager theo lockfile — installCommand phải khớp
  if (has('pnpm-lock.yaml')) hints.push('Lockfile: pnpm-lock.yaml → installCommand "pnpm install --frozen-lockfile".');
  else if (has('yarn.lock')) hints.push('Lockfile: yarn.lock → installCommand "yarn install --frozen-lockfile".');
  else if (has('bun.lockb') || has('bun.lock')) hints.push('Lockfile: bun → installCommand "bun install".');
  else if (has('package-lock.json')) hints.push('Lockfile: package-lock.json → installCommand "npm ci".');

  // 2) Next.js: phân biệt standalone (BACKEND) / export (STATIC) / SSR thường
  const nextCfg = file('next.config.js') || file('next.config.mjs') || file('next.config.ts');
  if (nextCfg) {
    if (/output\s*:\s*['"]standalone['"]/.test(nextCfg)) {
      hints.push(
        'Next.js output "standalone" → type BACKEND, internalPort 3000, dùng ĐÚNG 2 lệnh sau (chạy không Docker):',
        'buildCommand: npm run build && cp -r .next/static .next/standalone/.next/ && (cp -r public .next/standalone/ 2>/dev/null || true)',
        'startCommand: HOSTNAME=0.0.0.0 node .next/standalone/server.js',
      );
    } else if (/output\s*:\s*['"]export['"]/.test(nextCfg)) {
      hints.push('Next.js output "export" → type STATIC, outputDir "out".');
    } else {
      hints.push('Next.js SSR (không standalone/export) → type BACKEND, startCommand "npm run start", internalPort 3000.');
    }
  }

  // 3) NestJS: vị trí main.js sau build phụ thuộc tsconfig
  const pkg = file('package.json');
  if (/@nestjs\/core/.test(pkg)) {
    const ts = file('tsconfig.json') + file('tsconfig.build.json');
    const compilesOutsideSrc =
      has('schema.prisma') || /"include"\s*:\s*\[[^\]]*(prisma|scripts|libs)/.test(ts);
    hints.push(
      compilesOutsideSrc
        ? 'NestJS + compile cả thư mục ngoài src (vd prisma/) → file thật là dist/src/main.js → startCommand "node dist/src/main".'
        : 'NestJS chuẩn → startCommand "node dist/main".',
    );
  }

  // 4) Prisma → build phải generate client trước
  if (has('schema.prisma') || /"@prisma\/client"/.test(pkg)) {
    hints.push('Repo dùng Prisma → buildCommand PHẢI bắt đầu bằng "npx prisma generate && ".');
  }

  // 5) Scripts thật trong package.json — chọn lệnh theo đây, đừng bịa
  try {
    const scripts = (JSON.parse(pkg) as { scripts?: Record<string, string> }).scripts;
    if (scripts && Object.keys(scripts).length) {
      const brief = Object.entries(scripts)
        .filter(([k]) => /^(build|start|dev|preview|generate|export)/.test(k))
        .slice(0, 8)
        .map(([k, v]) => `"${k}": "${v}"`)
        .join(', ');
      if (brief) hints.push(`Scripts có thật: ${brief}.`);
    }
  } catch {
    /* package.json hỏng/cắt ngắn — bỏ qua */
  }

  // 6) Cổng khai trong .env.example
  const envExample = file('.env.example') || file('.env.sample');
  const portMatch = envExample.match(/^PORT\s*=\s*(\d{2,5})/m);
  if (portMatch) hints.push(`.env.example khai PORT=${portMatch[1]} → internalPort ${portMatch[1]}.`);

  return hints.length ? hints.map((h) => `- ${h}`).join('\n') : '';
}
