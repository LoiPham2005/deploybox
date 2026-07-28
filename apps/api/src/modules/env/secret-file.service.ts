import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SecretFileDto, UpsertSecretFileDto } from '@deploybox/shared';
import type { TeamRole } from '../../generated/prisma';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../infra/prisma/prisma.service';

const ROLE_ORDER: Record<TeamRole, number> = { MEMBER: 0, OWNER: 1 };

/**
 * Tệp bí mật của project (service account JSON, cert…): lưu mã hoá, khi deploy
 * ghi vào <appDir>/<path> để app đọc. Không đẩy git được nên quản lý ở đây.
 */
@Injectable()
export class SecretFileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  private async assertRole(userId: string, projectId: string, minRole: TeamRole = 'MEMBER') {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Không tìm thấy project');
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: project.teamId, userId } },
    });
    if (!member) throw new ForbiddenException('Bạn không thuộc team này');
    if (ROLE_ORDER[member.role] < ROLE_ORDER[minRole]) {
      throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này');
    }
    return project;
  }

  private safeDecrypt(enc: string): string {
    try {
      return this.crypto.decrypt(enc);
    } catch {
      return '';
    }
  }

  async list(userId: string, projectId: string): Promise<SecretFileDto[]> {
    await this.assertRole(userId, projectId);
    const files = await this.prisma.secretFile.findMany({
      where: { projectId },
      orderBy: { path: 'asc' },
    });
    return files.map((f) => ({
      path: f.path,
      size: Buffer.byteLength(this.safeDecrypt(f.content), 'utf8'),
      updatedAt: f.updatedAt.toISOString(),
    }));
  }

  async upsert(
    userId: string,
    projectId: string,
    dto: UpsertSecretFileDto,
  ): Promise<SecretFileDto[]> {
    await this.assertRole(userId, projectId, 'OWNER');
    const enc = this.crypto.encrypt(dto.content);
    await this.prisma.secretFile.upsert({
      where: { projectId_path: { projectId, path: dto.path } },
      update: { content: enc },
      create: { projectId, path: dto.path, content: enc },
    });
    return this.list(userId, projectId);
  }

  async remove(userId: string, projectId: string, path: string): Promise<void> {
    await this.assertRole(userId, projectId, 'OWNER');
    await this.prisma.secretFile.deleteMany({ where: { projectId, path } });
  }

  /** Nội bộ — deploy gọi để lấy nội dung giải mã ghi vào appDir. */
  async resolveForDeploy(
    projectId: string,
  ): Promise<{ path: string; content: string }[]> {
    const files = await this.prisma.secretFile.findMany({ where: { projectId } });
    return files.map((f) => ({ path: f.path, content: this.safeDecrypt(f.content) }));
  }
}
