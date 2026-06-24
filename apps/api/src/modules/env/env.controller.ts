import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { upsertEnvSchema, type UpsertEnvDto } from '@deploybox/shared';
import { EnvService } from './env.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  JwtAuthGuard,
  type JwtPayload,
} from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller()
export class EnvController {
  constructor(private readonly env: EnvService) {}

  @Get('projects/:projectId/env')
  list(@CurrentUser() user: JwtPayload, @Param('projectId') projectId: string) {
    return this.env.list(user.sub, projectId);
  }

  @Put('projects/:projectId/env')
  upsert(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(upsertEnvSchema)) dto: UpsertEnvDto,
  ) {
    return this.env.upsert(user.sub, projectId, dto);
  }

  @Delete('projects/:projectId/env/:key')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
    @Param('key') key: string,
  ) {
    return this.env.remove(user.sub, projectId, key);
  }
}
