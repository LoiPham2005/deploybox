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
import { BackupService } from './backup.service';
import { JwtAuthGuard, type JwtPayload } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/databases/:dbId/backups')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Get()
  list(
    @CurrentUser() u: JwtPayload,
    @Param('projectId') projectId: string,
    @Param('dbId') dbId: string,
  ) {
    return this.backup.list(u.sub, projectId, dbId);
  }

  @Get('stats')
  stats(
    @CurrentUser() u: JwtPayload,
    @Param('projectId') projectId: string,
    @Param('dbId') dbId: string,
  ) {
    return this.backup.stats(u.sub, projectId, dbId);
  }

  @Post()
  backupNow(
    @CurrentUser() u: JwtPayload,
    @Param('projectId') projectId: string,
    @Param('dbId') dbId: string,
  ) {
    return this.backup.backupNow(u.sub, projectId, dbId);
  }

  @Patch('auto')
  setAuto(
    @CurrentUser() u: JwtPayload,
    @Param('projectId') projectId: string,
    @Param('dbId') dbId: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.backup.setAuto(u.sub, projectId, dbId, !!body?.enabled);
  }

  @Get(':backupId/download')
  download(
    @CurrentUser() u: JwtPayload,
    @Param('projectId') projectId: string,
    @Param('backupId') backupId: string,
  ) {
    return this.backup.downloadUrl(u.sub, projectId, backupId);
  }

  @Delete(':backupId')
  remove(
    @CurrentUser() u: JwtPayload,
    @Param('projectId') projectId: string,
    @Param('backupId') backupId: string,
  ) {
    return this.backup.remove(u.sub, projectId, backupId);
  }
}
