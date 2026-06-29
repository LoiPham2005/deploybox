import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { GitService, type RemoteBranch } from './git.service';
import {
  JwtAuthGuard,
  type JwtPayload,
} from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('git')
export class GitController {
  constructor(private readonly git: GitService) {}

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
