import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { autofixStartCommand } from './start-autofix.util';

let dir: string;

beforeAll(async () => {
  // dist/src/main.js tồn tại, dist/main.js thì KHÔNG (ca NestJS + prisma ngoài src)
  dir = await mkdtemp(join(tmpdir(), 'autofix-'));
  await mkdir(join(dir, 'dist/src'), { recursive: true });
  await writeFile(join(dir, 'dist/src/main.js'), '// app');
});
afterAll(async () => rm(dir, { recursive: true, force: true }));

describe('autofixStartCommand', () => {
  it('dist/main sai → tự sửa thành dist/src/main.js', async () => {
    const r = await autofixStartCommand('node dist/main', dir);
    expect(r.fixed).toBeDefined();
    expect(r.cmd).toBe('node dist/src/main.js');
  });

  it('giữ nguyên cờ node (--experimental-websocket…)', async () => {
    const r = await autofixStartCommand('node --experimental-websocket dist/main.js', dir);
    expect(r.cmd).toBe('node --experimental-websocket dist/src/main.js');
  });

  it('file khai đúng → không đụng', async () => {
    const r = await autofixStartCommand('node dist/src/main', dir);
    expect(r.fixed).toBeUndefined();
  });

  it('lệnh không phải node dist…main → không đoán mò', async () => {
    const r = await autofixStartCommand('npm run start:prod', dir);
    expect(r.cmd).toBe('npm run start:prod');
    expect(r.fixed).toBeUndefined();
  });
});
