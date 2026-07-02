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
