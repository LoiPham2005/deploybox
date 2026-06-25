import { Injectable } from '@nestjs/common';
import { spawn } from 'child_process';
import { capture, runStreaming, type LogFn } from '../process.util';

export interface ContainerStats {
  cpu: string;
  mem: string;
  memPerc: string;
}

export interface RunContainerOptions {
  name: string;
  image: string;
  internalPort: number;
  env: Record<string, string>;
  memoryMb: number;
  cpuLimit: number;
}

/**
 * Bọc CLI `docker` (tôn trọng docker context hiện hành — Colima cục bộ hoặc
 * DOCKER_HOST từ xa khi lên VPS). Dùng shell-out để khỏi cấu hình socket.
 */
@Injectable()
export class DockerService {
  async buildImage(
    tag: string,
    contextDir: string,
    log: LogFn,
    signal?: AbortSignal,
  ): Promise<void> {
    log(`$ docker build -t ${tag} .`, 'stdout');
    await runStreaming('docker', ['build', '-t', tag, contextDir], { log, signal });
  }

  /** Chạy container nền, publish cổng app ra một host port ngẫu nhiên. */
  async run(opts: RunContainerOptions): Promise<string> {
    const envArgs = Object.entries(opts.env).flatMap(([k, v]) => [
      '-e',
      `${k}=${v}`,
    ]);
    const { stdout, stderr, code } = await capture('docker', [
      'run',
      '-d',
      '--name',
      opts.name,
      '--restart',
      'unless-stopped',
      '-p',
      String(opts.internalPort), // chỉ cổng container -> host port ngẫu nhiên
      '--memory',
      `${opts.memoryMb}m`,
      '--cpus',
      String(opts.cpuLimit),
      '--pids-limit',
      '256',
      ...envArgs,
      opts.image,
    ]);
    if (code !== 0) {
      throw new Error(`docker run lỗi: ${stderr.trim() || 'không rõ'}`);
    }
    return stdout.trim();
  }

  /** Đọc host port đang ánh xạ tới internalPort của container. */
  async getHostPort(
    name: string,
    internalPort: number,
  ): Promise<number | null> {
    const { stdout, code } = await capture('docker', [
      'port',
      name,
      String(internalPort),
    ]);
    if (code !== 0) return null;
    const match = stdout.trim().split('\n')[0]?.match(/:(\d+)\s*$/);
    return match ? Number(match[1]) : null;
  }

  async remove(name: string): Promise<void> {
    await capture('docker', ['rm', '-f', name]);
  }

  /** Dừng container nhưng GIỮ lại (cho scale-to-zero — start lại được). */
  async stop(name: string): Promise<void> {
    await capture('docker', ['stop', name]);
  }

  /** Khởi động lại container đã stop (giữ nguyên port mapping). */
  async start(name: string): Promise<void> {
    await capture('docker', ['start', name]);
  }

  /** Stream docker logs -f; trả về hàm cleanup để kill process khi client ngắt. */
  streamLogs(name: string, onLine: (line: string) => void): () => void {
    const child = spawn('docker', ['logs', '-f', '--tail', '300', name]);
    const onData = (buf: Buffer) => {
      buf.toString().split('\n').forEach((l) => { if (l.trim()) onLine(l); });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    return () => { try { child.kill(); } catch { /* ignore */ } };
  }

  /** Lấy CPU/RAM của container (một lần, không stream). */
  async stats(name: string): Promise<ContainerStats | null> {
    const { stdout, code } = await capture('docker', [
      'stats', '--no-stream', '--format', '{{json .}}', name,
    ]);
    if (code !== 0 || !stdout.trim()) return null;
    try {
      const row = JSON.parse(stdout.trim().split('\n')[0]) as {
        CPUPerc: string; MemUsage: string; MemPerc: string;
      };
      return { cpu: row.CPUPerc, mem: row.MemUsage, memPerc: row.MemPerc };
    } catch {
      return null;
    }
  }
}
