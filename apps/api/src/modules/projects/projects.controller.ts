import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  createProjectSchema,
  updateProjectSchema,
  type CreateProjectDto,
  type UpdateProjectDto,
} from '@deploybox/shared';
import { ProjectsService } from './projects.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  JwtAuthGuard,
  type JwtPayload,
} from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('teams/:teamId/projects')
  list(@CurrentUser() user: JwtPayload, @Param('teamId') teamId: string) {
    return this.projects.list(user.sub, teamId);
  }

  @Post('teams/:teamId/projects')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('teamId') teamId: string,
    @Body(new ZodValidationPipe(createProjectSchema)) dto: CreateProjectDto,
  ) {
    return this.projects.create(user.sub, teamId, dto);
  }

  /** ⚙️ AI sinh GitHub Actions workflow cho project. */
  @Post('projects/:projectId/generate-ci')
  generateCi(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
  ) {
    return this.projects.generateCi(user.sub, projectId);
  }

  @Get('projects/:projectId')
  get(@CurrentUser() user: JwtPayload, @Param('projectId') projectId: string) {
    return this.projects.get(user.sub, projectId);
  }

  @Patch('projects/:projectId')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(updateProjectSchema)) dto: UpdateProjectDto,
  ) {
    return this.projects.update(user.sub, projectId, dto);
  }

  @Delete('projects/:projectId')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
  ) {
    return this.projects.remove(user.sub, projectId);
  }
}
