import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import type { CompleteOpts, CompleteResult, LlmProvider, VisionOpts } from './llm-provider';

/** Đổi JSON Schema thường → Schema của Gemini (type UPPERCASE, bỏ additionalProperties). */
function toGeminiSchema(js: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const t = String(js.type ?? '').toUpperCase();
  if (t) out.type = t;
  if (js.description) out.description = js.description;
  if (Array.isArray(js.enum)) out.enum = js.enum;
  if (js.properties && typeof js.properties === 'object') {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(js.properties as Record<string, unknown>)) {
      props[k] = toGeminiSchema(v as Record<string, unknown>);
    }
    out.properties = props;
  }
  if (Array.isArray(js.required)) out.required = js.required;
  if (js.items) out.items = toGeminiSchema(js.items as Record<string, unknown>);
  return out;
}

/**
 * Gemini hay nhét ký tự control thô vào STRING literal của JSON.
 * Vá đúng cách: đi qua từng ký tự, chỉ escape control char khi ĐANG Ở TRONG string
 * (newline/tab cấu trúc của pretty-print giữ nguyên — không phá JSON nhiều dòng).
 */
function safeJsonParse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* vá rồi thử lại bên dưới */
  }
  let out = '';
  let inStr = false;
  let esc = false;
  for (const ch of text) {
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === '\\') { out += ch; esc = true; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        out += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : ch === '\t' ? '\\t' : '';
        continue;
      }
      out += ch;
    } else {
      if (ch === '"') inStr = true;
      out += ch;
    }
  }
  return JSON.parse(out) as Record<string, unknown>;
}

/** Google Gemini — ép khuôn bằng responseSchema + parse an toàn. */
@Injectable()
export class GeminiProvider implements LlmProvider {
  readonly id = 'gemini' as const;
  readonly label = 'Gemini';
  readonly suggestedModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro'];
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

  async complete({ model, system, user, schema }: CompleteOpts): Promise<CompleteResult> {
    const res = await this.getClient().models.generateContent({
      model,
      contents: user,
      config: {
        systemInstruction: system,
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(schema),
      },
    });
    const text = res.text;
    if (!text) throw new Error('Gemini không trả về nội dung');
    return {
      data: safeJsonParse(text),
      inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }

  async completeVision({ model, system, user, schema, imageBase64, imageMime }: VisionOpts): Promise<CompleteResult> {
    const res = await this.getClient().models.generateContent({
      model,
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: imageMime, data: imageBase64 } },
          { text: user },
        ],
      }],
      config: {
        systemInstruction: system,
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(schema),
      },
    });
    const text = res.text;
    if (!text) throw new Error('Gemini không trả về nội dung');
    return {
      data: safeJsonParse(text),
      inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }
}
