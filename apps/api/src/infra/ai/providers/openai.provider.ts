import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { CompleteOpts, LlmProvider } from './llm-provider';

/** ChatGPT (OpenAI) — dùng response_format json_schema (strict). */
@Injectable()
export class OpenaiProvider implements LlmProvider {
  readonly id = 'openai' as const;
  readonly label = 'ChatGPT';
  readonly suggestedModels = ['gpt-4o', 'gpt-4o-mini'];
  private client: OpenAI | null = null;

  constructor(private readonly config: ConfigService) {}

  private key(): string {
    return (this.config.get<string>('OPENAI_API_KEY') ?? '').trim();
  }

  isConfigured(): boolean {
    return !!this.key();
  }

  private getClient(): OpenAI {
    if (!this.client) this.client = new OpenAI({ apiKey: this.key() });
    return this.client;
  }

  async complete({ model, system, user, schema }: CompleteOpts): Promise<Record<string, unknown>> {
    const res = await this.getClient().chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'diagnosis', schema, strict: true },
      },
    });
    const content = res.choices[0]?.message?.content;
    if (!content) throw new Error('ChatGPT không trả về nội dung');
    return JSON.parse(content) as Record<string, unknown>;
  }
}
