import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiConfigStatus, AiDiagnosis, AiProviderId } from '@deploybox/shared';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import type { LlmProvider } from './providers/llm-provider';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenaiProvider } from './providers/openai.provider';
import { GeminiProvider } from './providers/gemini.provider';

const CONFIG_FIELDS = [
  'installCommand',
  'buildCommand',
  'startCommand',
  'outputDir',
  'internalPort',
  'rootDir',
  'artifactPath',
  'none',
] as const;
type ConfigField = (typeof CONFIG_FIELDS)[number];

const CONFIDENCES = ['cao', 'trung bình', 'thấp'] as const;
type Confidence = (typeof CONFIDENCES)[number];

/** JSON schema bắt buộc AI trả về (structured output — không cần zod). */
const DIAGNOSIS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    cause: { type: 'string', description: 'Nguyên nhân gốc, 1–2 câu tiếng Việt.' },
    fix: {
      type: 'string',
      description: 'Cách sửa theo bước, tiếng Việt, ngắn gọn và thực tế.',
    },
    commands: {
      type: 'array',
      items: { type: 'string' },
      description: 'Lệnh shell hoặc đoạn cấu hình cần chạy/sửa. Rỗng nếu không có.',
    },
    configField: {
      type: 'string',
      enum: [...CONFIG_FIELDS],
      description: 'Trường cấu hình project nên sửa, "none" nếu không liên quan.',
    },
    configValue: {
      type: 'string',
      description: 'Giá trị đề xuất cho configField ("" nếu là "none").',
    },
    confidence: {
      type: 'string',
      enum: [...CONFIDENCES],
      description: 'Mức độ tự tin của chẩn đoán.',
    },
  },
  required: ['cause', 'fix', 'commands', 'configField', 'configValue', 'confidence'],
  additionalProperties: false,
};

export interface DiagnoseInput {
  projectName: string;
  projectType: string; // STATIC | BACKEND | MOBILE
  useDocker: boolean;
  installCommand?: string | null;
  buildCommand?: string | null;
  startCommand?: string | null;
  outputDir?: string | null;
  internalPort?: number | null;
  rootDir?: string | null;
  errorMessage?: string | null;
  log: string; // toàn bộ build log (sẽ tự cắt bớt)
}

const SYSTEM_PROMPT = `Bạn là kỹ sư DevOps của DeployBox — một nền tảng tự deploy (giống Coolify/Vercel).
Nhiệm vụ: đọc log build/deploy THẤT BẠI và chỉ ra NGUYÊN NHÂN gốc + CÁCH SỬA, ngắn gọn, thực tế, bằng tiếng Việt.

Ngăn xếp thường gặp: Node/npm/pnpm, NestJS, Next.js, Prisma, Vite, Docker, và chế độ "chạy thẳng trên host" (không Docker).
Các lỗi phổ biến cần ưu tiên nhận diện:
- Thiếu devDependencies (npm ci bỏ qua khi NODE_ENV=production) → dùng "npm ci --include=dev".
- Prisma client rỗng/chưa generate → thêm "npx prisma generate" trước khi build.
- Sai lệnh build/start (vd start sai đường dẫn dist: node dist/main vs node dist/src/main).
- Thiếu thư mục output (outputDir) hoặc sai vị trí.
- Sai cổng (internalPort) so với cổng app thực sự lắng nghe.
- Thiếu biến môi trường (env) lúc build/runtime.
- Hết RAM khi build, lỗi mạng khi git clone / npm install, sai Node version.

Quy tắc:
- Dựa CHÍNH vào log. KHÔNG bịa. Nếu không đủ dữ kiện, đặt confidence = "thấp" và nói rõ cần kiểm tra gì.
- "fix" phải hành động được ngay. "commands" chứa lệnh/đoạn config cụ thể (nếu có).
- Nếu lỗi sửa bằng cách đổi một trường cấu hình project, đặt configField + configValue tương ứng.`;

/**
 * AI "bác sĩ lỗi deploy" đa nhà cung cấp (Claude / ChatGPT / Gemini).
 * Provider + model dùng toàn app được lưu trong DB (bảng Setting) — admin đổi bất cứ lúc nào.
 * Bật/tắt tổng bằng feature flag `ai_features`.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly providers: Record<AiProviderId, LlmProvider>;
  private cfgCache: { provider: AiProviderId; model: string } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly flags: FeatureFlagsService,
    anthropic: AnthropicProvider,
    openai: OpenaiProvider,
    gemini: GeminiProvider,
  ) {
    this.providers = { anthropic, openai, gemini };
  }

  /** Admin có bật tính năng AI không. */
  isEnabled(): boolean {
    return this.flags.isEnabled('ai_features');
  }

  private normProvider(v?: string): AiProviderId {
    return v === 'openai' || v === 'gemini' || v === 'anthropic' ? v : 'anthropic';
  }

  private defaultModelFor(provider: AiProviderId): string {
    if (provider === 'anthropic') {
      return this.config.get<string>('AI_MODEL', 'claude-opus-4-8');
    }
    return this.providers[provider].suggestedModels[0];
  }

  /** Provider + model đang chọn (đọc DB, cache RAM). */
  async getConfig(): Promise<{ provider: AiProviderId; model: string }> {
    if (this.cfgCache) return this.cfgCache;
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: ['ai_provider', 'ai_model'] } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const provider = this.normProvider(map.get('ai_provider'));
    const model = (map.get('ai_model') ?? '').trim() || this.defaultModelFor(provider);
    this.cfgCache = { provider, model };
    return this.cfgCache;
  }

  /** Admin đổi provider + model dùng toàn app. */
  async setConfig(provider: string, model: string): Promise<AiConfigStatus> {
    const p = this.normProvider(provider);
    if (provider !== p) {
      throw new BadRequestException('Nhà cung cấp AI không hợp lệ');
    }
    const m = (model ?? '').trim() || this.defaultModelFor(p);
    await this.prisma.$transaction([
      this.prisma.setting.upsert({
        where: { key: 'ai_provider' },
        update: { value: p },
        create: { key: 'ai_provider', value: p },
      }),
      this.prisma.setting.upsert({
        where: { key: 'ai_model' },
        update: { value: m },
        create: { key: 'ai_model', value: m },
      }),
    ]);
    this.cfgCache = { provider: p, model: m };
    return this.status();
  }

  /** Trạng thái cho trang Admin: provider/model đang chọn + danh sách nhà cung cấp. */
  async status(): Promise<AiConfigStatus> {
    const cfg = await this.getConfig();
    return {
      provider: cfg.provider,
      model: cfg.model,
      providers: (Object.keys(this.providers) as AiProviderId[]).map((id) => {
        const p = this.providers[id];
        return {
          id: p.id,
          label: p.label,
          configured: p.isConfigured(),
          suggestedModels: p.suggestedModels,
        };
      }),
    };
  }

  /** Chẩn đoán lỗi deploy. Ném lỗi thân thiện nếu tắt / chưa cấu hình / gọi AI thất bại. */
  async diagnose(input: DiagnoseInput): Promise<AiDiagnosis> {
    if (!this.isEnabled()) {
      throw new BadRequestException(
        'Tính năng AI chẩn đoán đang tắt. Admin bật lại ở tab Admin → Tính năng hệ thống.',
      );
    }
    const cfg = await this.getConfig();
    const provider = this.providers[cfg.provider];
    if (!provider.isConfigured()) {
      throw new BadRequestException(
        `Chưa cấu hình API key cho ${provider.label} trên server. Thêm key vào .env rồi restart, hoặc chọn nhà cung cấp khác ở tab Admin.`,
      );
    }

    try {
      const raw = await provider.complete({
        model: cfg.model,
        system: SYSTEM_PROMPT,
        user: this.buildUserContent(input),
        schema: DIAGNOSIS_SCHEMA,
      });
      return {
        ...this.coerce(raw),
        model: `${provider.label} · ${cfg.model}`,
        createdAt: new Date().toISOString(),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`AI (${provider.id}/${cfg.model}) chẩn đoán thất bại: ${msg}`);
      throw new BadRequestException(`Gọi ${provider.label} thất bại: ${msg}`);
    }
  }

  /** Chuẩn hoá/khoá giá trị về đúng union (phòng khi AI lệch nhẹ). */
  private coerce(raw: Record<string, unknown>): Omit<AiDiagnosis, 'model' | 'createdAt'> {
    const configField = CONFIG_FIELDS.includes(raw.configField as ConfigField)
      ? (raw.configField as ConfigField)
      : 'none';
    const confidence = CONFIDENCES.includes(raw.confidence as Confidence)
      ? (raw.confidence as Confidence)
      : 'trung bình';
    const commands = Array.isArray(raw.commands)
      ? raw.commands.filter((c): c is string => typeof c === 'string')
      : [];
    return {
      cause: String(raw.cause ?? '').trim(),
      fix: String(raw.fix ?? '').trim(),
      commands,
      configField,
      configValue: String(raw.configValue ?? ''),
      confidence,
    };
  }

  private buildUserContent(input: DiagnoseInput): string {
    // Cắt log để giới hạn token — giữ phần CUỐI (nơi lỗi thường xuất hiện).
    const MAX = 12000;
    const log =
      input.log.length > MAX
        ? '...(đã lược bớt phần đầu)...\n' + input.log.slice(-MAX)
        : input.log;

    const cfg = [
      `- Loại project: ${input.projectType}`,
      `- Chạy Docker: ${input.useDocker ? 'có' : 'không (chạy thẳng trên host)'}`,
      input.rootDir ? `- rootDir: ${input.rootDir}` : null,
      input.installCommand ? `- installCommand: ${input.installCommand}` : null,
      input.buildCommand ? `- buildCommand: ${input.buildCommand}` : null,
      input.startCommand ? `- startCommand: ${input.startCommand}` : null,
      input.outputDir ? `- outputDir: ${input.outputDir}` : null,
      input.internalPort ? `- internalPort: ${input.internalPort}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    return [
      `Project: ${input.projectName}`,
      '',
      'Cấu hình build/deploy:',
      cfg,
      '',
      input.errorMessage ? `Thông báo lỗi tóm tắt: ${input.errorMessage}` : '',
      '',
      'Build log (phần cuối):',
      '```',
      log,
      '```',
      '',
      // Hợp đồng JSON — đảm bảo mọi nhà cung cấp trả đúng khuôn (nhất là Gemini).
      'Trả về DUY NHẤT một object JSON, không kèm chữ nào khác, với đúng các khoá:',
      '- cause (string), fix (string), commands (mảng string)',
      '- configField (một trong: installCommand, buildCommand, startCommand, outputDir, internalPort, rootDir, none)',
      '- configValue (string), confidence (một trong: cao, trung bình, thấp)',
    ]
      .filter((l) => l !== '')
      .join('\n');
  }
}
