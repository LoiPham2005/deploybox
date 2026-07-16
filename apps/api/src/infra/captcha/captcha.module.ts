import { Global, Module } from '@nestjs/common';
import { CaptchaService } from './captcha.service';

@Global() // auth (login/register) + admin đều cần
@Module({
  providers: [CaptchaService],
  exports: [CaptchaService],
})
export class CaptchaModule {}
