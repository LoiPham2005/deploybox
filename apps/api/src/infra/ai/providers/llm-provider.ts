import type { AiProviderId } from '@deploybox/shared';

export interface CompleteOpts {
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>; // JSON schema (provider nào dùng được thì dùng)
}

/** Kết quả 1 lượt gọi: JSON đã parse + số token (để tính chi phí). */
export interface CompleteResult {
  data: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
}

/** Gọi kèm 1 ảnh (vision) — cho tính năng đọc ảnh lỗi. */
export interface VisionOpts extends CompleteOpts {
  imageBase64: string;
  imageMime: string; // image/jpeg | image/png…
}

/** Một nhà cung cấp LLM. Trả JSON object (đã parse) đúng schema + usage. */
export interface LlmProvider {
  readonly id: AiProviderId;
  readonly label: string;
  readonly suggestedModels: string[];
  isConfigured(): boolean;
  complete(opts: CompleteOpts): Promise<CompleteResult>;
  /** Gọi kèm ảnh (mọi provider hiện có đều hỗ trợ vision). */
  completeVision(opts: VisionOpts): Promise<CompleteResult>;
}
