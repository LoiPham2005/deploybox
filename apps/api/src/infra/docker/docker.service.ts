import { Injectable } from '@nestjs/common';
import { capture, runStreaming, type LogFn } from '../process.util';

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
  ): Promise<void> {
    log(`$ docker build -t ${tag} .`, 'stdout');
    await runStreaming('docker', ['build', '-t', tag, contextDir], { log });
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
}
