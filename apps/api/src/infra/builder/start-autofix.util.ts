import { access, readdir } from 'fs/promises';
import { join } from 'path';

/**
 * 🔧 Tự sửa đường dẫn file main trong startCommand khi build xuất ra chỗ khác
 * (ca thật: NestJS "node dist/main" nhưng tsconfig compile cả prisma/ →
 * file thật nằm ở dist/src/main.js). Tìm file thật trong dist rồi thay.
 * Trả về lệnh (đã sửa hoặc nguyên bản) + thông tin sửa để log.
 */
export async function autofixStartCommand(
  startCmd: string,
  workDir: string,
): Promise<{ cmd: string; fixed?: { from: string; to: string } }> {
  // Chỉ đụng dạng "node <path-có-dist-và-main>" — không đoán mò lệnh khác
  const m = startCmd.match(/(^|\s)node\s+(?:--[\w-]+(?:=\S+)?\s+)*(\S*dist\S*main(?:\.js)?)(\s|$)/);
  if (!m) return { cmd: startCmd };
  const target = m[2];

  const exists = async (p: string) =>
    access(join(workDir, p)).then(() => true).catch(() => false);

  // File khai báo có thật (thử cả biến thể .js) → không sửa gì
  if (await exists(target) || await exists(target.endsWith('.js') ? target : `${target}.js`)) {
    return { cmd: startCmd };
  }

  // Dò main.js thật trong dist (tối đa 3 cấp) — ưu tiên đường ngắn nhất
  const found: string[] = [];
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > 3 || found.length >= 5) return;
    const entries = await readdir(join(workDir, rel), { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const p = `${rel}/${e.name}`;
      if (e.isFile() && e.name === 'main.js') found.push(p);
      else if (e.isDirectory() && !['node_modules', '.git'].includes(e.name)) {
        await walk(p, depth + 1);
      }
    }
  };
  await walk('dist', 1);
  if (!found.length) return { cmd: startCmd };

  found.sort((a, b) => a.length - b.length);
  const real = found[0];
  return {
    cmd: startCmd.replace(target, real),
    fixed: { from: target, to: real },
  };
}
