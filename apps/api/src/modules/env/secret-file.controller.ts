import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  upsertSecretFileSchema,
  type UpsertSecretFileDto,
} from '@deploybox/shared';
import { SecretFileService } from './secret-file.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard, type JwtPayload } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller()
export class SecretFileController {
  constructor(private readonly files: SecretFileService) {}

  @Get('projects/:projectId/secret-files')
  list(@CurrentUser() user: JwtPayload, @Param('projectId') projectId: string) {
    return this.files.list(user.sub, projectId);
  }

  @Put('projects/:projectId/secret-files')
  upsert(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(upsertSecretFileSchema)) dto: UpsertSecretFileDto,
  ) {
    return this.files.upsert(user.sub, projectId, dto);
  }

  @Delete('projects/:projectId/secret-files')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
    @Query('path') path: string,
  ) {
    return this.files.remove(user.sub, projectId, path);
  }
}
