import { Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, type JwtPayload } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TelegramLinkService } from './telegram-link.service';
import { PrismaService } from '../../infra/prisma/prisma.service';

@UseGuards(JwtAuthGuard)
@Controller('me/telegram')
export class TelegramController {
  constructor(
    private readonly link: TelegramLinkService,
    private readonly prisma: PrismaService,
  ) {}

  /** Trạng thái: instance có bật bot không + user này đã nối chưa. */
  @Get()
  async status(@CurrentUser() user: JwtPayload) {
    const u = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { telegramChatId: true },
    });
    return {
      enabled: this.link.isEnabled(),
      connected: !!u?.telegramChatId,
      botUsername: this.link.getBotUsername(),
    };
  }

  /** Sinh deep-link để user bấm nối Telegram. */
  @Post('link')
  async createLink(@CurrentUser() user: JwtPayload) {
    const res = await this.link.createLink(user.sub);
    if (!res) return { ok: false, error: 'Instance chưa cấu hình bot Telegram (TELEGRAM_BOT_TOKEN).' };
    return { ok: true, ...res };
  }

  /** Ngắt kết nối Telegram của user. */
  @Delete()
  async unlink(@CurrentUser() user: JwtPayload) {
    await this.prisma.user.update({
      where: { id: user.sub },
      data: { telegramChatId: null, telegramLinkCode: null },
    });
    return { ok: true };
  }
}
