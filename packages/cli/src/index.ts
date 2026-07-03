#!/usr/bin/env node
/**
 * deploybox CLI — deploy / xem log / list project từ terminal.
 * Không phụ thuộc package ngoài (chỉ Node built-in + fetch của Node 18+).
 *
 * Config lưu ở ~/.deploybox/config.json : { apiUrl, token }
 * Token = API token dạng "deploybox_…" tạo ở dashboard (Settings → Tokens).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.deploybox');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

interface Config {
  apiUrl: string;
  token: string;
}
interface CliProject {
  id: string;
  name: string;
  slug: string;
  teamId: string;
  type: string;
  status: string;
  url?: string | null;
}

// ── màu terminal (không cần thư viện) ──
const c = {
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
};

function die(msg: string): never {
  console.error(c.red('✗ ' + msg));
  process.exit(1);
}

function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) {
    die('Chưa đăng nhập. Chạy:  deploybox login --url <API_URL> --token <deploybox_...>');
  }
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as Config;
  } catch {
    die('File cấu hình hỏng: ' + CONFIG_FILE);
  }
}

function saveConfig(cfg: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

/** Đọc cờ dạng --key value từ argv. */
function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function api<T>(cfg: Config, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${cfg.apiUrl}/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    die(`API ${res.status}: ${body.message ?? res.statusText}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/** Tìm project theo slug hoặc id (báo lỗi rõ nếu không thấy / trùng). */
async function resolveProject(cfg: Config, ref: string): Promise<CliProject> {
  const projects = await api<CliProject[]>(cfg, '/cli/projects');
  const hit = projects.filter((p) => p.id === ref || p.slug === ref);
  if (hit.length === 0) {
    die(`Không tìm thấy project "${ref}". Xem danh sách: deploybox list`);
  }
  if (hit.length > 1) {
    die(`"${ref}" trùng nhiều project — dùng id thay vì slug.`);
  }
  return hit[0];
}

/** Stream build log của 1 deployment (SSE) tới khi 'done'. */
async function streamLogs(cfg: Config, deploymentId: string): Promise<void> {
  const res = await fetch(
    `${cfg.apiUrl}/api/v1/deployments/${deploymentId}/logs/stream`,
    { headers: { Authorization: `Bearer ${cfg.token}` } },
  );
  if (!res.ok || !res.body) die(`Không mở được log stream (HTTP ${res.status})`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (event === 'done') return;
      if (event === 'log' && data) {
        try {
          console.log(JSON.parse(data));
        } catch {
          console.log(data);
        }
      }
    }
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────

async function cmdLogin(args: string[]): Promise<void> {
  const url = (flag(args, 'url') ?? '').replace(/\/$/, '');
  const token = flag(args, 'token') ?? '';
  if (!url || !token) {
    die('Cách dùng: deploybox login --url https://api.sneakup.io.vn --token deploybox_xxx');
  }
  const cfg: Config = { apiUrl: url, token };
  const me = await api<{ email: string }>(cfg, '/cli/me');
  saveConfig(cfg);
  console.log(c.green(`✓ Đã đăng nhập: ${me.email}`));
  console.log(c.gray(`  Lưu tại ${CONFIG_FILE}`));
}

async function cmdWhoami(): Promise<void> {
  const cfg = loadConfig();
  const me = await api<{ email: string }>(cfg, '/cli/me');
  console.log(`${c.bold(me.email)}  ${c.gray('@ ' + cfg.apiUrl)}`);
}

const STATUS_COLOR: Record<string, (s: string) => string> = {
  RUNNING: c.green,
  FAILED: c.red,
  BUILDING: c.yellow,
  DEPLOYING: c.yellow,
  QUEUED: c.gray,
  STOPPED: c.gray,
  SLEEPING: c.gray,
  NONE: c.gray,
};

async function cmdList(): Promise<void> {
  const cfg = loadConfig();
  const projects = await api<CliProject[]>(cfg, '/cli/projects');
  if (projects.length === 0) {
    console.log(c.gray('(chưa có project nào)'));
    return;
  }
  const w = Math.max(...projects.map((p) => p.slug.length), 6);
  console.log(c.gray(`${'SLUG'.padEnd(w)}  STATUS      TYPE      URL`));
  for (const p of projects) {
    const color = STATUS_COLOR[p.status] ?? c.gray;
    console.log(
      `${c.cyan(p.slug.padEnd(w))}  ${color(p.status.padEnd(10))}  ${p.type.padEnd(8)}  ${c.gray(p.url ?? '')}`,
    );
  }
}

async function cmdDeploy(args: string[]): Promise<void> {
  const ref = args.find((a) => !a.startsWith('--'));
  if (!ref) die('Cách dùng: deploybox deploy <slug|id> [--no-logs]');
  const cfg = loadConfig();
  const project = await resolveProject(cfg, ref);
  console.log(c.gray(`→ Deploy ${c.cyan(project.slug)} …`));
  const dep = await api<{ id: string }>(cfg, `/projects/${project.id}/deploy`, {
    method: 'POST',
  });
  console.log(c.gray(`  deployment ${dep.id}`));
  if (args.includes('--no-logs')) {
    console.log(c.green('✓ Đã tạo deployment (bỏ qua log).'));
    return;
  }
  console.log(c.gray('  ── build log ──'));
  await streamLogs(cfg, dep.id);
  // Trạng thái cuối
  const view = await api<{ deployment: { status: string }; url?: string | null }>(
    cfg,
    `/deployments/${dep.id}`,
  );
  const s = view.deployment.status;
  if (s === 'RUNNING') {
    console.log(c.green(`\n✓ Deploy thành công${view.url ? ' → ' + view.url : ''}`));
  } else {
    console.log(c.red(`\n✗ Deploy kết thúc với trạng thái: ${s}`));
    process.exit(1);
  }
}

async function cmdLogs(args: string[]): Promise<void> {
  const id = args.find((a) => !a.startsWith('--'));
  if (!id) die('Cách dùng: deploybox logs <deploymentId>');
  const cfg = loadConfig();
  await streamLogs(cfg, id);
}

function cmdHelp(): void {
  console.log(`${c.bold('deploybox')} — CLI deploy cho DeployBox

  ${c.cyan('login')}   --url <API_URL> --token <deploybox_...>   Đăng nhập (lưu token)
  ${c.cyan('whoami')}                                            Xem đang đăng nhập bằng ai
  ${c.cyan('list')}                                              Liệt kê project (slug, trạng thái, URL)
  ${c.cyan('deploy')}  <slug|id> [--no-logs]                     Deploy + xem log realtime
  ${c.cyan('logs')}    <deploymentId>                            Stream log 1 deployment
  ${c.cyan('help')}                                              Trợ giúp

Token tạo ở dashboard: Settings → Tokens.`);
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'login': return cmdLogin(args);
    case 'whoami': return cmdWhoami();
    case 'list': case 'ls': case 'projects': return cmdList();
    case 'deploy': return cmdDeploy(args);
    case 'logs': return cmdLogs(args);
    case 'help': case '--help': case '-h': case undefined: return cmdHelp();
    default:
      console.error(c.red(`Lệnh không rõ: ${cmd}`));
      cmdHelp();
      process.exit(1);
  }
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
