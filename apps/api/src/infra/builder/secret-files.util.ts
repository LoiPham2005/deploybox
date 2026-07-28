import { mkdir, writeFile } from 'fs/promises';
import { dirname, isAbsolute, join, normalize } from 'path';
import type { LogFn } from '../process.util';

export interface SecretFileInput {
  path: string; // tương đối trong app
  content: string;
}

/**
 * Ghi các tệp bí mật vào appDir (sau clone, trước build). Chặn path thoát ra ngoài.
 * host-run: app đọc trực tiếp. Docker: nằm trong build context → COPY vào image.
 */
export async function writeSecretFiles(
  baseDir: string,
  files: SecretFileInput[] | undefined,
  log?: LogFn,
): Promise<void> {
  if (!files?.length) return;
  for (const f of files) {
    const rel = normalize(f.path);
    if (isAbsolute(rel) || rel.startsWith('..')) {
      log?.(`⚠️ Bỏ qua tệp bí mật path không hợp lệ: ${f.path}`, 'stderr');
      continue;
    }
    const dest = join(baseDir, rel);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, f.content, 'utf8');
    log?.(`🔐 Ghi tệp bí mật: ${rel} (${Buffer.byteLength(f.content)} bytes)`, 'stdout');
  }
}
