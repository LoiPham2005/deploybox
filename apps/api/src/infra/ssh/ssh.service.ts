import { Injectable, Logger } from '@nestjs/common';
import { Client, type ConnectConfig } from 'ssh2';

export interface SshOpts {
  host: string;
  port: number;
  username: string;
  privateKey: string;
}

@Injectable()
export class SshService {
  private readonly logger = new Logger(SshService.name);

  private connect(opts: SshOpts): Promise<Client> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      const timer = setTimeout(() => {
        conn.destroy();
        reject(new Error(`SSH timeout kết nối tới ${opts.host}:${opts.port}`));
      }, 15_000);
      conn
        .on('ready', () => { clearTimeout(timer); resolve(conn); })
        .on('error', (e) => { clearTimeout(timer); reject(e); })
        .connect({
          host: opts.host,
          port: opts.port,
          username: opts.username,
          privateKey: opts.privateKey,
          readyTimeout: 14_000,
        } satisfies ConnectConfig);
    });
  }

  /** Chạy lệnh shell trên server từ xa, stream từng dòng output về. */
  async exec(
    opts: SshOpts,
    command: string,
    onLine?: (line: string) => void,
  ): Promise<void> {
    const conn = await this.connect(opts);
    return new Promise((resolve, reject) => {
      conn.exec(command, { pty: false }, (err, stream) => {
        if (err) { conn.end(); return reject(err); }

        let stderr = '';
        const emit = (raw: Buffer, prefix = '') => {
          raw.toString('utf8').split('\n').forEach((line) => {
            if (line.trim()) onLine?.(`${prefix}${line}`);
          });
        };

        stream
          .on('data', (d: Buffer) => emit(d))
          .stderr.on('data', (d: Buffer) => {
            stderr += d.toString();
            emit(d, '[err] ');
          });

        stream.on('close', (code: number) => {
          conn.end();
          if (code === 0) resolve();
          else reject(new Error(`SSH exit ${code}: ${stderr.slice(0, 300)}`));
        });
      });
    });
  }

  /** Kiểm tra kết nối SSH — trả về true nếu thành công. */
  async testConnection(opts: SshOpts): Promise<boolean> {
    try {
      const conn = await this.connect(opts);
      conn.end();
      return true;
    } catch (e) {
      this.logger.debug(`SSH test failed for ${opts.host}: ${e}`);
      return false;
    }
  }
}
