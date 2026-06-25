import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { GitService } from './git.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('git')
export class GitController {
  constructor(private readonly git: GitService) {}

  @Post('branches')
  async branches(
    @Body() body: { repoUrl: string; gitToken?: string },
  ): Promise<{ branches: string[] }> {
    const branches = await this.git.listBranches(body.repoUrl, body.gitToken);
    return { branches };
  }
}
