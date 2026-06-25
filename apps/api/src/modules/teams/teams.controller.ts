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
  inviteMemberSchema,
  updateMemberRoleSchema,
  type InviteMemberDto,
  type UpdateMemberRoleDto,
} from '@deploybox/shared';
import { TeamsService } from './teams.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard, type JwtPayload } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('teams/:teamId/members')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload, @Param('teamId') teamId: string) {
    return this.teams.listMembers(user.sub, teamId);
  }

  @Post('invite')
  invite(
    @CurrentUser() user: JwtPayload,
    @Param('teamId') teamId: string,
    @Body(new ZodValidationPipe(inviteMemberSchema)) dto: InviteMemberDto,
  ) {
    return this.teams.invite(user.sub, teamId, dto.email, dto.role ?? 'MEMBER');
  }

  @Patch(':memberId/role')
  updateRole(
    @CurrentUser() user: JwtPayload,
    @Param('teamId') teamId: string,
    @Param('memberId') memberId: string,
    @Body(new ZodValidationPipe(updateMemberRoleSchema)) dto: UpdateMemberRoleDto,
  ) {
    return this.teams.updateRole(user.sub, teamId, memberId, dto.role);
  }

  @Delete(':memberId')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('teamId') teamId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.teams.removeMember(user.sub, teamId, memberId);
  }
}
