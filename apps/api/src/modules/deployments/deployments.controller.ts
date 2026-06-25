import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DeploymentsService } from './deployments.service';
import { LogBroadcastService } from '../../infra/log-broadcast/log-broadcast.service';
import { DockerService } from '../../infra/docker/docker.service';
import {
  JwtAuthGuard,
  type JwtPayload,
} from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

const TERMINAL = new Set(['RUNNING', 'FAILED', 'STOPPED', 'CANCELLED', 'SLEEPING']);

function sseHeaders(res: Response): void {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
}

function sseWrite(res: Response, event: string, data: string): void {
  res.write(`event: ${event}\ndata: ${data}\n\n`);
}

@UseGuards(JwtAuthGuard)
@Controller()
export class DeploymentsController {
  constructor(
    private readonly deployments: DeploymentsService,
    private readonly broadcast: LogBroadcastService,
    private readonly docker: DockerService,
  ) {}

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
  list(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.deployments.list(
      user.sub,
      projectId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
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

  /** SSE: stream build log realtime. Replay file trước, rồi stream live. */
  @Get('deployments/:deploymentId/logs/stream')
  async streamBuildLogs(
    @CurrentUser() user: JwtPayload,
    @Param('deploymentId') deploymentId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { status } = await this.deployments.getDeploymentForStream(user.sub, deploymentId);

    sseHeaders(res);

    // Replay existing log file
    const existing = await this.deployments.getLogs(deploymentId);
    for (const line of existing.split('\n')) {
      if (line.trim()) sseWrite(res, 'log', JSON.stringify(line));
    }

    // Already done — send end immediately
    if (TERMINAL.has(status)) {
      sseWrite(res, 'done', '{}');
      res.end();
      return;
    }

    let closed = false;
    const offLine = this.broadcast.onLine(deploymentId, (line) => {
      if (!closed) sseWrite(res, 'log', JSON.stringify(line));
    });
    const offEnd = this.broadcast.onEnd(deploymentId, () => {
      if (!closed) { sseWrite(res, 'done', '{}'); cleanup(); }
    });

    const cleanup = () => {
      closed = true;
      offLine();
      offEnd();
      if (!res.writableEnded) res.end();
    };
    req.on('close', cleanup);
  }

  /** SSE: stream runtime log của container backend đang chạy. */
  @Get('deployments/:deploymentId/runtime-logs')
  async streamRuntimeLogs(
    @CurrentUser() user: JwtPayload,
    @Param('deploymentId') deploymentId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { projectSlug, projectType } = await this.deployments.getDeploymentForStream(
      user.sub,
      deploymentId,
    );

    sseHeaders(res);

    if (projectType !== 'BACKEND') {
      sseWrite(res, 'error', JSON.stringify('Chỉ hỗ trợ project BACKEND'));
      res.end();
      return;
    }

    const kill = this.docker.streamLogs(`deploybox-${projectSlug}`, (line) => {
      if (!res.writableEnded) sseWrite(res, 'log', JSON.stringify(line));
    });

    req.on('close', () => {
      kill();
      if (!res.writableEnded) res.end();
    });
  }

  /** Container CPU/RAM stats (one-shot, frontend polls). */
  @Get('projects/:projectId/metrics')
  getMetrics(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
  ) {
    return this.deployments.getContainerMetrics(user.sub, projectId);
  }
}
