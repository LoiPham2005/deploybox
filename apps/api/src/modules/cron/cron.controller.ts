import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  createCronSchema,
  updateCronSchema,
  type CreateCronDto,
  type UpdateCronDto,
} from '@deploybox/shared';
import { CronService } from './cron.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard, type JwtPayload } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/cron')
export class CronController {
  constructor(private readonly cron: CronService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload, @Param('projectId') projectId: string) {
    return this.cron.list(user.sub, projectId);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createCronSchema)) dto: CreateCronDto,
  ) {
    return this.cron.create(user.sub, projectId, dto);
  }

  @Patch(':cronId')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
    @Param('cronId') cronId: string,
    @Body(new ZodValidationPipe(updateCronSchema)) dto: UpdateCronDto,
  ) {
    return this.cron.update(user.sub, projectId, cronId, dto);
  }

  @Delete(':cronId')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
    @Param('cronId') cronId: string,
  ) {
    return this.cron.remove(user.sub, projectId, cronId);
  }

  /** Chạy ngay (không đợi lịch). */
  @Post(':cronId/run')
  runNow(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
    @Param('cronId') cronId: string,
  ) {
    return this.cron.runNow(user.sub, projectId, cronId);
  }
}
