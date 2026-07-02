/**
 * Quét secret lộ trong repo (regex thuần — nhanh, không tốn AI, không bịa).
 * Trả về danh sách cảnh báo tiếng Việt; rỗng = không thấy gì.
 */

const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'Anthropic API key', re: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
  { name: 'OpenAI API key', re: /sk-(?:proj-)?[a-zA-Z0-9_-]{32,}/ },
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{30,}/ },
  { name: 'GitHub token', re: /(?:ghp_|github_pat_)[a-zA-Z0-9_]{20,}/ },
  { name: 'GitLab token', re: /glpat-[a-zA-Z0-9_-]{20,}/ },
  { name: 'Slack token', re: /xox[bp]-[0-9A-Za-z-]{20,}/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Telegram bot token', re: /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}\b/ },
  { name: 'Private key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  {
    name: 'Connection string có mật khẩu',
    re: /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/]+:[^\s@/]{3,}@/,
  },
];

// File .env thật (có secret) — .env.example/.env.sample là file mẫu, không sao
const ENV_FILE_RE = /(^|\/)\.env(\.(local|production|prod|development|dev|staging|stg))?$/;

/**
 * @param tree  danh sách đường dẫn file trong repo (mỗi dòng 1 path)
 * @param files nội dung các file đã đọc (path → content)
 */
export function scanForSecrets(
  tree: string,
  files: Record<string, string>,
): string[] {
  const warnings: string[] = [];

  // 1) File .env thật bị commit vào repo
  for (const path of tree.split('\n')) {
    if (ENV_FILE_RE.test(path.trim())) {
      warnings.push(
        `File "${path.trim()}" bị commit vào repo — chứa secret thật thì phải xoá khỏi git và đổi toàn bộ key/mật khẩu bên trong.`,
      );
    }
  }

  // 2) Secret nằm trong nội dung file đã đọc
  for (const [path, content] of Object.entries(files)) {
    if (/\.example|\.sample/.test(path)) continue; // file mẫu — giá trị thường là placeholder
    for (const { name, re } of SECRET_PATTERNS) {
      const m = content.match(re);
      if (m) {
        const masked = m[0].slice(0, 8) + '…' + m[0].slice(-4);
        warnings.push(`${name} lộ trong "${path}" (${masked}) — thu hồi/đổi key này ngay.`);
      }
    }
  }

  return [...new Set(warnings)].slice(0, 10);
}

/**
 * Che secret trong 1 dòng log: giá trị env bí mật của project + token/key khớp
 * pattern chung. Dùng cho build log (che cả trước khi gửi AI đọc).
 */
export function maskSecrets(line: string, secretValues: string[] = []): string {
  let out = line;
  for (const v of secretValues) {
    if (v && v.length >= 6) out = out.split(v).join('•••');
  }
  for (const { re } of SECRET_PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), (m) =>
      m.length > 12 ? m.slice(0, 4) + '•••' + m.slice(-3) : '•••',
    );
  }
  return out;
}

/** Gợi ý vận hành theo loại lỗi trong log crash/smoke-fail. '' nếu không nhận ra. */
export function opsTip(log: string, memoryMb?: number): string {
  if (/JavaScript heap out of memory|ENOMEM|OOMKilled|Out of memory|Killed\b/i.test(log)) {
    return `App hết RAM${memoryMb ? ` (giới hạn hiện tại ${memoryMb}MB)` : ''} — tăng memoryMb trong Sửa cấu hình, hoặc kiểm tra memory leak.`;
  }
  if (/EADDRINUSE/i.test(log)) {
    return 'Cổng bị chiếm (EADDRINUSE) — app khác đang dùng cổng này; đổi internalPort hoặc tắt app kia.';
  }
  if (/P1001|Can't reach database|ECONNREFUSED.*(5432|3306|27017)|Connection terminated/i.test(log)) {
    return 'Không kết nối được database — kiểm tra DATABASE_URL trong tab Env và tình trạng DB server.';
  }
  if (/MODULE_NOT_FOUND|Cannot find module/i.test(log)) {
    return 'Thiếu module — thường do thiếu devDependencies khi build: thử installCommand "npm ci --include=dev".';
  }
  if (/EACCES|permission denied/i.test(log)) {
    return 'Lỗi quyền truy cập file/thư mục — kiểm tra quyền của thư mục app hoặc cổng <1024.';
  }
  return '';
}
