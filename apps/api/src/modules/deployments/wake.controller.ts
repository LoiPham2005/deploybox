import { All, Controller, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SleepService } from '../../infra/sleep/sleep.service';

// Public — Caddy chuyển request của app đang ngủ tới đây để đánh thức container.
@Controller('internal')
export class WakeController {
  constructor(private readonly sleep: SleepService) {}

  @All('wake/:slug')
  async wake(
    @Param('slug') slug: string,
    @Res() res: Response,
  ): Promise<void> {
    const ok = await this.sleep.wake(slug);
    if (!ok) {
      res.status(503).type('text/plain').send('App chưa sẵn sàng, thử lại.');
      return;
    }
    res
      .status(200)
      .type('html')
      .send(
        '<!doctype html><html><head><meta charset="utf-8">' +
          '<meta http-equiv="refresh" content="1">' +
          '<title>Đang khởi động…</title>' +
          '<style>body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}</style>' +
          '</head><body><div>⏳ Đang khởi động ứng dụng… trang sẽ tự tải lại.</div></body></html>',
      );
  }
}
