import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { DeploymentsService } from './deployments.service';
import {
  JwtAuthGuard,
  type JwtPayload,
} from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller()
export class DeploymentsController {
  constructor(private readonly deployments: DeploymentsService) {}

  @Post('projects/:projectId/deploy')
  deploy(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
  ) {
    return this.deployments.deploy(user.sub, projectId);
  }

  @Post('projects/:projectId/redeploy')
  redeploy(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
  ) {
    return this.deployments.redeploy(user.sub, projectId);
  }

  @Post('projects/:projectId/stop')
  stop(@CurrentUser() user: JwtPayload, @Param('projectId') projectId: string) {
    return this.deployments.stop(user.sub, projectId);
  }

  @Post('projects/:projectId/sleep')
  sleepProject(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
  ) {
    return this.deployments.sleepProject(user.sub, projectId);
  }

  @Get('projects/:projectId/deployments')
  list(@CurrentUser() user: JwtPayload, @Param('projectId') projectId: string) {
    return this.deployments.list(user.sub, projectId);
  }

  @Get('deployments/:deploymentId')
  get(
    @CurrentUser() user: JwtPayload,
    @Param('deploymentId') deploymentId: string,
  ) {
    return this.deployments.getView(user.sub, deploymentId);
  }

  @Post('deployments/:deploymentId/rollback')
  rollback(
    @CurrentUser() user: JwtPayload,
    @Param('deploymentId') deploymentId: string,
  ) {
    return this.deployments.rollback(user.sub, deploymentId);
  }
}
