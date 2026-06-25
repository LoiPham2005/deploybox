import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ServersService } from './servers.service';
import { JwtAuthGuard, type JwtPayload } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { createServerSchema, type CreateServerDto } from '@deploybox/shared';

@UseGuards(JwtAuthGuard)
@Controller()
export class ServersController {
  constructor(private readonly servers: ServersService) {}

  @Get('teams/:teamId/servers')
  list(@CurrentUser() user: JwtPayload, @Param('teamId') teamId: string) {
    return this.servers.list(user.sub, teamId);
  }

  @Post('teams/:teamId/servers')
  add(
    @CurrentUser() user: JwtPayload,
    @Param('teamId') teamId: string,
    @Body(new ZodValidationPipe(createServerSchema)) dto: CreateServerDto,
  ) {
    return this.servers.add(user.sub, teamId, dto);
  }

  @Delete('servers/:serverId')
  remove(@CurrentUser() user: JwtPayload, @Param('serverId') serverId: string) {
    return this.servers.remove(user.sub, serverId);
  }

  @Post('servers/:serverId/test')
  test(@CurrentUser() user: JwtPayload, @Param('serverId') serverId: string) {
    return this.servers.testConnection(user.sub, serverId);
  }
}
