import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import type { CompleteOpts, LlmProvider } from './llm-provider';

/** Google Gemini — dùng responseMimeType JSON (schema mô tả trong prompt). */
@Injectable()
export class GeminiProvider implements LlmProvider {
  readonly id = 'gemini' as const;
  readonly label = 'Gemini';
  readonly suggestedModels = ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'];
  private client: GoogleGenAI | null = null;

  constructor(private readonly config: ConfigService) {}

  private key(): string {
    return (this.config.get<string>('GEMINI_API_KEY') ?? '').trim();
  }

  isConfigured(): boolean {
    return !!this.key();
  }

  private getClient(): GoogleGenAI {
    if (!this.client) this.client = new GoogleGenAI({ apiKey: this.key() });
    return this.client;
  }

  async complete({ model, system, user }: CompleteOpts): Promise<Record<string, unknown>> {
    const res = await this.getClient().models.generateContent({
      model,
      contents: user,
      config: {
        systemInstruction: system,
        responseMimeType: 'application/json',
      },
    });
    const text = res.text;
    if (!text) throw new Error('Gemini không trả về nội dung');
    return JSON.parse(text) as Record<string, unknown>;
  }
}
