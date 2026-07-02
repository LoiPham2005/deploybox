import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import type { AiProjectSuggestion } from '@deploybox/shared';
import { GitService, type RemoteBranch } from './git.service';
import { AiService } from '../../infra/ai/ai.service';
import {
  JwtAuthGuard,
  type JwtPayload,
} from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('git')
export class GitController {
  constructor(
    private readonly git: GitService,
    private readonly ai: AiService,
  ) {}

  /** ✨ Tự nhận diện cấu hình: clone nông repo → AI đọc → đề xuất config. */
  @Post('analyze')
  async analyze(
    @Body()
    body: {
      repoUrl: string;
      gitToken?: string;
      branch?: string;
      authMode?: string;
      gitUsername?: string;
    },
  ): Promise<AiProjectSuggestion> {
    const snapshot = await this.git.snapshotRepo(
      body.repoUrl,
      body.gitToken,
      body.branch,
      (body.authMode as any) ?? 'auto',
      body.gitUsername,
    );
    return this.ai.analyzeRepo({
      repoUrl: body.repoUrl,
      branch: body.branch,
      tree: snapshot.tree,
      files: snapshot.files,
    });
  }

  // Lấy branches khi TẠO project mới — token nhập trực tiếp trong body
  @Post('branches')
  async branches(
    @Body()
    body: {
      repoUrl: string;
      gitToken?: string;
      authMode?: string;
      gitUsername?: string;
    },
  ): Promise<{ branches: RemoteBranch[] }> {
    const branches = await this.git.listBranches(
      body.repoUrl,
      body.gitToken,
      (body.authMode as any) ?? 'auto',
      body.gitUsername,
    );
    return { branches };
  }

  // Lấy branches cho project đã tồn tại — dùng token đã lưu (form Sửa cấu hình)
  @Post('projects/:projectId/branches')
  async projectBranches(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
  ): Promise<{ branches: RemoteBranch[] }> {
    const branches = await this.git.listBranchesForProject(projectId, user.sub);
    return { branches };
  }
}
