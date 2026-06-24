import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { addDomainSchema, type AddDomainDto } from '@deploybox/shared';
import { DomainsService } from './domains.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  JwtAuthGuard,
  type JwtPayload,
} from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller()
export class DomainsController {
  constructor(private readonly domains: DomainsService) {}

  @Get('projects/:projectId/domains')
  list(@CurrentUser() user: JwtPayload, @Param('projectId') projectId: string) {
    return this.domains.list(user.sub, projectId);
  }

  @Post('projects/:projectId/domains')
  add(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(addDomainSchema)) dto: AddDomainDto,
  ) {
    return this.domains.add(user.sub, projectId, dto);
  }

  @Post('domains/:domainId/verify')
  verify(
    @CurrentUser() user: JwtPayload,
    @Param('domainId') domainId: string,
  ) {
    return this.domains.verify(user.sub, domainId);
  }

  @Delete('domains/:domainId')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('domainId') domainId: string,
  ) {
    return this.domains.remove(user.sub, domainId);
  }
}
