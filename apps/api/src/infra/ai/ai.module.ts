import { Global, Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenaiProvider } from './providers/openai.provider';
import { GeminiProvider } from './providers/gemini.provider';

/** AI "bác sĩ lỗi deploy" đa nhà cung cấp — global để dùng chung toàn app. */
@Global()
@Module({
  providers: [AiService, AnthropicProvider, OpenaiProvider, GeminiProvider],
  exports: [AiService],
})
export class AiModule {}
