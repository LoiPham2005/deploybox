import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import type { CompleteOpts, LlmProvider } from './llm-provider';

/** Claude (Anthropic) — dùng structured output json_schema. */
@Injectable()
export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic' as const;
  readonly label = 'Claude';
  readonly suggestedModels = [
    'claude-opus-4-8',
    'claude-sonnet-5',
    'claude-haiku-4-5',
  ];
  private client: Anthropic | null = null;

  constructor(private readonly config: ConfigService) {}

  private key(): string {
    return (this.config.get<string>('ANTHROPIC_API_KEY') ?? '').trim();
  }

  isConfigured(): boolean {
    return !!this.key();
  }

  private getClient(): Anthropic {
    if (!this.client) this.client = new Anthropic({ apiKey: this.key() });
    return this.client;
  }

  async complete({ model, system, user, schema }: CompleteOpts): Promise<Record<string, unknown>> {
    const res = await this.getClient().messages.create({
      model,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { format: { type: 'json_schema', schema } },
    });
    const text = res.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') throw new Error('Claude không trả về nội dung');
    return JSON.parse(text.text) as Record<string, unknown>;
  }
}
