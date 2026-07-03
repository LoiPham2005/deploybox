import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { createDatabaseSchema, type CreateDatabaseDto } from '@deploybox/shared';
import { DatabaseService } from './database.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard, type JwtPayload } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/databases')
export class DatabaseController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload, @Param('projectId') projectId: string) {
    return this.db.list(user.sub, projectId);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createDatabaseSchema)) dto: CreateDatabaseDto,
  ) {
    return this.db.create(user.sub, projectId, dto);
  }

  @Delete(':dbId')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
    @Param('dbId') dbId: string,
  ) {
    return this.db.remove(user.sub, projectId, dbId);
  }
}
