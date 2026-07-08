import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type { CompleteOpts, CompleteResult, LlmProvider, VisionOpts } from './llm-provider';
import { AiKeyService } from '../ai-key.service';

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

  constructor(private readonly keys: AiKeyService) {}

  async isConfigured(): Promise<boolean> {
    return !!(await this.keys.getKey('anthropic'));
  }

  // Tạo client theo key hiệu lực mỗi lần gọi (key đổi ở UI là nhận ngay, không cache cũ).
  private async getClient(): Promise<Anthropic> {
    return new Anthropic({ apiKey: await this.keys.getKey('anthropic') });
  }

  async complete({ model, system, user, schema }: CompleteOpts): Promise<CompleteResult> {
    const res = await (await this.getClient()).messages.create({
      model,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { format: { type: 'json_schema', schema } },
    });
    const text = res.content.find((b: { type: string }) => b.type === 'text');
    if (!text || text.type !== 'text') throw new Error('Claude không trả về nội dung');
    return {
      data: JSON.parse(text.text) as Record<string, unknown>,
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
    };
  }

  async completeVision({ model, system, user, schema, imageBase64, imageMime }: VisionOpts): Promise<CompleteResult> {
    const res = await (await this.getClient()).messages.create({
      model,
      max_tokens: 4096,
      system,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: imageMime as 'image/jpeg', data: imageBase64 },
          },
          { type: 'text', text: user },
        ],
      }],
      output_config: { format: { type: 'json_schema', schema } },
    });
    const text = res.content.find((b: { type: string }) => b.type === 'text');
    if (!text || text.type !== 'text') throw new Error('Claude không trả về nội dung');
    return {
      data: JSON.parse(text.text) as Record<string, unknown>,
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
    };
  }
}
