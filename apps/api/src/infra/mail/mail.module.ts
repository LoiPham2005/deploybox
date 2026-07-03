import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

/** Gửi email (OTP, thông báo) — global để module nào cũng dùng được. */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
