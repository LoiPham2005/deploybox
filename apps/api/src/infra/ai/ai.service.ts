import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import type { AiDiagnosis } from '@deploybox/shared';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

const CONFIG_FIELDS = [
  'installCommand',
  'buildCommand',
  'startCommand',
  'outputDir',
  'internalPort',
  'rootDir',
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
 * "Bác sĩ lỗi deploy": đọc log thất bại → nguyên nhân + cách sửa (structured output).
 * Gọi Claude qua @anthropic-ai/sdk. Bật/tắt bằng feature flag `ai_features` + có ANTHROPIC_API_KEY.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private client: Anthropic | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly flags: FeatureFlagsService,
  ) {}

  /** Đã có API key chưa. */
  isConfigured(): boolean {
    return !!(this.config.get<string>('ANTHROPIC_API_KEY') ?? '').trim();
  }

  /** Admin có bật tính năng AI không. */
  isEnabled(): boolean {
    return this.flags.isEnabled('ai_features');
  }

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({
        apiKey: this.config.get<string>('ANTHROPIC_API_KEY'),
      });
    }
    return this.client;
  }

  /** Chẩn đoán lỗi deploy. Ném lỗi thân thiện nếu tắt / chưa cấu hình / gọi AI thất bại. */
  async diagnose(input: DiagnoseInput): Promise<AiDiagnosis> {
    if (!this.isEnabled()) {
      throw new BadRequestException(
        'Tính năng AI chẩn đoán đang tắt. Admin bật lại ở tab Admin → Tính năng hệ thống.',
      );
    }
    if (!this.isConfigured()) {
      throw new BadRequestException(
        'Chưa cấu hình ANTHROPIC_API_KEY trên server nên chưa dùng được AI.',
      );
    }

    const model = this.config.get<string>('AI_MODEL', 'claude-opus-4-8');

    try {
      const res = await this.getClient().messages.create({
        model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: this.buildUserContent(input) }],
        output_config: { format: { type: 'json_schema', schema: DIAGNOSIS_SCHEMA } },
      });

      const raw = this.extractJson(res);
      return { ...this.coerce(raw), model, createdAt: new Date().toISOString() };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`AI chẩn đoán thất bại: ${msg}`);
      throw new BadRequestException(`Gọi AI thất bại: ${msg}`);
    }
  }

  /** Bản "best-effort": trả null thay vì ném lỗi (dùng khi chạy nền). */
  async tryDiagnose(input: DiagnoseInput): Promise<AiDiagnosis | null> {
    if (!this.isEnabled() || !this.isConfigured()) return null;
    try {
      return await this.diagnose(input);
    } catch {
      return null;
    }
  }

  /** Lấy khối text đầu tiên (structured output đảm bảo là JSON hợp lệ) và parse. */
  private extractJson(res: Anthropic.Message): Record<string, unknown> {
    const text = res.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      throw new Error('AI không trả về nội dung');
    }
    return JSON.parse(text.text) as Record<string, unknown>;
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
      'Hãy chẩn đoán nguyên nhân và cách sửa theo schema JSON yêu cầu.',
    ]
      .filter((l) => l !== '')
      .join('\n');
  }
}
