import { Injectable } from '@nestjs/common';
import { copyFile, mkdir, rm } from 'fs/promises';
import { basename, join } from 'path';
import { runStreaming, type LogFn } from '../process.util';

export interface MobileBuildInput {
  deploymentId: string;
  slug: string;
  repoUrl: string;          // URL thực để clone (có thể chứa token)
  repoUrlDisplay?: string;  // URL hiển thị trong log (không có token)
  branch: string;
  rootDir: string;
  buildImage?: string;      // Docker image toolchain — để TRỐNG để build trên host
  buildCommand: string;
  artifactPath: string;
  dataDir: string;
  signal?: AbortSignal;
}

export interface MobileBuildOutput {
  artifactFile: string; // đường dẫn tuyệt đối file artifact đã copy ra ngoài
  fileName: string;     // tên file (vd app-release.apk)
}

/**
 * Build app mobile. Hỗ trợ 2 chế độ:
 *
 * A) Host build (buildImage trống) — dùng toolchain cài sẵn trên máy (fvm, flutter…)
 *    Nhanh, không cần pull Docker image, phù hợp máy dev đã có FVM/Flutter.
 *    buildCommand chạy trực tiếp trong thư mục repo với env của process.
 *
 * B) Docker build (buildImage có giá trị) — clone rồi chạy bên trong container
 *    Portable, không phụ thuộc máy host, phù hợp VPS/CI.
 *    Env vars BUILD/BOTH được inject qua -e flags.
 */
@Injectable()
export class MobileBuilder {
  async build(
    input: MobileBuildInput,
    buildEnv: Record<string, string>,
    log: LogFn,
  ): Promise<MobileBuildOutput> {
    const workDir = join(input.dataDir, 'work', input.deploymentId);
    const artifactsDir = join(input.dataDir, 'artifacts', input.deploymentId);
    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true });
    await mkdir(artifactsDir, { recursive: true });

    // 1. Clone repo (log URL không có token)
    log(`$ git clone --depth 1 --branch ${input.branch} ${input.repoUrlDisplay ?? input.repoUrl}`, 'stdout');
    await runStreaming(
      'git',
      ['clone', '--depth', '1', '--branch', input.branch, input.repoUrl, workDir],
      { cwd: input.dataDir, log, signal: input.signal },
    );

    const appDir = join(workDir, input.rootDir || '.');

    // 2. Build
    if (input.buildImage) {
      // Chế độ B: Docker container
      const envFlags: string[] = [];
      for (const [k, v] of Object.entries(buildEnv)) {
        envFlags.push('-e', `${k}=${v}`);
      }
      log(`$ docker run --rm -v "${appDir}:/workspace" -w /workspace ${input.buildImage} sh -c "${input.buildCommand}"`, 'stdout');
      await runStreaming(
        'docker',
        ['run', '--rm', '-v', `${appDir}:/workspace`, '-w', '/workspace', ...envFlags, input.buildImage, 'sh', '-c', input.buildCommand],
        { cwd: appDir, log, signal: input.signal },
      );
    } else {
      // Chế độ A: Host build — dùng fvm/flutter cài sẵn trên máy
      log(`[Host build] $ ${input.buildCommand}`, 'stdout');
      log('Sử dụng toolchain trên máy host (fvm/flutter đã cài)', 'stdout');
      const envWithBuild = Object.fromEntries(
        Object.entries({ ...process.env, ...buildEnv }).filter((e): e is [string, string] => e[1] !== undefined),
      );
      await runStreaming(
        'sh',
        ['-c', input.buildCommand],
        { cwd: appDir, log, env: envWithBuild, signal: input.signal },
      );
    }

    // 3. Copy artifact ra ngoài workDir
    const srcArtifact = join(appDir, input.artifactPath);
    const fileName = basename(srcArtifact);
    const destArtifact = join(artifactsDir, fileName);
    log(`Sao chép artifact → artifacts/${input.deploymentId}/${fileName}`, 'stdout');
    await copyFile(srcArtifact, destArtifact);

    await rm(workDir, { recursive: true, force: true });
    return { artifactFile: destArtifact, fileName };
  }
}
