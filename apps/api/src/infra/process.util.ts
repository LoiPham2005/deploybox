import { spawn } from 'child_process';

export type LogFn = (line: string, stream: 'stdout' | 'stderr') => void;

/** Chạy lệnh, stream stdout/stderr theo dòng vào log; reject nếu mã thoát != 0. */
export function runStreaming(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; log: LogFn },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
    });
    const onData =
      (stream: 'stdout' | 'stderr') =>
      (buf: Buffer): void => {
        buf
          .toString()
          .split('\n')
          .forEach((line) => {
            if (line.trim()) opts.log(line, stream);
          });
      };
    child.stdout.on('data', onData('stdout'));
    child.stderr.on('data', onData('stderr'));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`"${cmd}" thoát với mã ${code}`)),
    );
  });
}

/** Chạy lệnh, gom toàn bộ output (không stream). */
export function capture(
  cmd: string,
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}
