import type { AiProviderId } from '@deploybox/shared';

export interface CompleteOpts {
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>; // JSON schema (provider nào dùng được thì dùng)
}

/** Một nhà cung cấp LLM. Trả JSON object (đã parse) đúng schema chẩn đoán. */
export interface LlmProvider {
  readonly id: AiProviderId;
  readonly label: string;
  readonly suggestedModels: string[];
  isConfigured(): boolean;
  complete(opts: CompleteOpts): Promise<Record<string, unknown>>;
}
