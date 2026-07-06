import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AiConfigStatus,
  AiDiagnosis,
  AiProjectSuggestion,
  AiProviderId,
} from '@deploybox/shared';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import type { LlmProvider } from './providers/llm-provider';
import { errorSig } from './error-sig.util';
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

/** JSON schema cho "tự nhận diện cấu hình" từ repo. */
const SUGGESTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['STATIC', 'BACKEND', 'MOBILE'],
      description:
        'STATIC = web build ra file tĩnh; BACKEND = server chạy liên tục (API/SSR); MOBILE = app Flutter build APK/AAB.',
    },
    framework: { type: 'string', description: 'Tên framework: "Next.js", "NestJS", "Vite + React", "Flutter"…' },
    rootDir: { type: 'string', description: 'Thư mục chứa project thật (nơi có package.json/pubspec.yaml). "." nếu ở gốc repo.' },
    installCommand: { type: 'string', description: 'Lệnh cài dependency. "" nếu dùng mặc định (npm ci).' },
    buildCommand: { type: 'string', description: 'Lệnh build. Nhớ thêm "npx prisma generate &&" nếu project dùng Prisma. "" nếu không cần build.' },
    startCommand: { type: 'string', description: 'Chỉ BACKEND: lệnh chạy production (vd "node dist/main.js"). "" nếu không phải BACKEND.' },
    outputDir: { type: 'string', description: 'Chỉ STATIC: thư mục chứa file build ra (dist, out…). "" nếu không phải STATIC.' },
    internalPort: { type: 'integer', description: 'Chỉ BACKEND: cổng app lắng nghe (đọc từ code/config; mặc định framework nếu không rõ). 0 nếu không phải BACKEND.' },
    buildImage: { type: 'string', description: 'Chỉ MOBILE: Docker image build (vd "cirrusci/flutter:stable"). "" nếu không phải MOBILE.' },
    artifactPath: { type: 'string', description: 'Chỉ MOBILE: đường dẫn file APK/AAB sau build. "" nếu không phải MOBILE.' },
    envKeys: {
      type: 'array',
      items: { type: 'string' },
      description: 'Tên các biến môi trường app cần lúc chạy/build (đọc từ .env.example, code). Rỗng nếu không thấy.',
    },
    reason: { type: 'string', description: 'Giải thích ngắn gọn (1–2 câu, tiếng Việt) vì sao nhận diện như vậy.' },
    apps: {
      type: 'array',
      description:
        'MONOREPO: repo chứa NHIỀU app deploy độc lập (vd backend + web) → liệt kê TẤT CẢ app ở đây (kể cả app chính). Repo chỉ 1 app → mảng RỖNG.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Tên ngắn gợi ý, vd "backend", "web".' },
          type: { type: 'string', enum: ['STATIC', 'BACKEND', 'MOBILE'] },
          rootDir: { type: 'string', description: 'Thư mục của app này trong repo.' },
          buildCommand: { type: 'string' },
          startCommand: { type: 'string', description: '"" nếu không phải BACKEND.' },
          outputDir: { type: 'string', description: '"" nếu không phải STATIC.' },
          internalPort: { type: 'integer', description: '0 nếu không phải BACKEND. Mỗi app 1 cổng KHÁC nhau.' },
        },
        required: ['name', 'type', 'rootDir', 'buildCommand', 'startCommand', 'outputDir', 'internalPort'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'type', 'framework', 'rootDir', 'installCommand', 'buildCommand', 'startCommand',
    'outputDir', 'internalPort', 'buildImage', 'artifactPath', 'envKeys', 'reason', 'apps',
  ],
  additionalProperties: false,
};

const ANALYZE_SYSTEM_PROMPT = `Bạn là kỹ sư DevOps của DeployBox — nền tảng tự deploy.
Nhiệm vụ: đọc CÂY FILE + nội dung file chìa khóa của một repo và đề xuất cấu hình deploy CHÍNH XÁC.

Phân loại type:
- STATIC: web build ra file tĩnh (Vite/CRA/Vue, Next.js có "output: export"…). Cần buildCommand + outputDir.
- BACKEND: server chạy liên tục (NestJS/Express/FastAPI/Next.js SSR…). Cần buildCommand + startCommand + internalPort.
- MOBILE: app Flutter build APK/AAB. Cần buildCommand + buildImage + artifactPath.

Quy tắc QUAN TRỌNG:
- Chỉ đưa giá trị CỤ THỂ đọc được từ repo. TUYỆT ĐỐI không dùng placeholder kiểu "[tên thư mục của bạn]".
- rootDir: nếu package.json/pubspec.yaml nằm trong thư mục con, đặt rootDir = thư mục đó.
- Dựa vào scripts trong package.json để chọn build/start (vd "start:prod", "build"). NestJS build ra dist/main.js (hoặc dist/src/main.js nếu tsconfig có rootDir src + include prisma).
- Project dùng Prisma → buildCommand phải có "npx prisma generate && " đằng trước.
- internalPort: tìm trong code/config (main.ts, .env.example PORT…); không rõ thì dùng mặc định framework (Next 3000, NestJS 3000, FastAPI 8000).
- Next.js KHÔNG có "output: export" → BACKEND (SSR) với startCommand "npm run start" (hoặc "next start").
- Next.js có "output: standalone" → BACKEND, internalPort 3000, và PHẢI dùng đúng cặp lệnh:
  buildCommand: npm run build && cp -r .next/static .next/standalone/.next/ && (cp -r public .next/standalone/ 2>/dev/null || true)
  startCommand: HOSTNAME=0.0.0.0 node .next/standalone/server.js
- installCommand PHẢI khớp lockfile: pnpm-lock.yaml → pnpm, yarn.lock → yarn, bun.lockb → bun, package-lock.json → npm ci.
- Nếu có mục "KẾT LUẬN ĐÃ PHÂN TÍCH SẴN" trong input: các dòng đó do code phân tích chắc chắn — ƯU TIÊN TIN chúng hơn suy đoán của bạn khi mâu thuẫn.
- buildImage (MOBILE): CHỈ dùng image công khai CÓ THẬT trên registry, vd "ghcr.io/cirruslabs/flutter:stable" hoặc "cirrusci/flutter:stable". Không tự bịa tên image.
- MOBILE có flavor (android/app/build.gradle có productFlavors) → buildCommand kèm --flavor và artifactPath đúng tên file flavor (vd app-prod-release.apk).
- LUÔN điền framework (tên framework chính) và reason (1–2 câu tiếng Việt) — không để trống.
- envKeys: liệt kê từ .env.example và những biến bắt buộc thấy trong config.
- MONOREPO: nếu repo chứa NHIỀU app deploy độc lập (vd apps/backend + apps/web, hoặc backend/ + frontend/),
  điền app QUAN TRỌNG NHẤT vào các trường gốc và liệt kê TẤT CẢ app vào mảng "apps"
  (mỗi app đúng rootDir + lệnh + cổng riêng, cổng không trùng nhau). Repo 1 app → apps = [].`;

export interface AnalyzeRepoInput {
  repoUrl: string;
  branch?: string;
  tree: string;
  files: Record<string, string>;
  /** Kết luận deterministic từ code (lockfile, standalone, NestJS main path…) — AI ưu tiên tin. */
  hints?: string;
}

/** Schema cho hỏi đáp tự do (Telegram bot). */
const ANSWER_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    answer: {
      type: 'string',
      description: 'Câu trả lời tiếng Việt, ngắn gọn, plain text (không markdown).',
    },
  },
  required: ['answer'],
  additionalProperties: false,
};

const ANSWER_SYSTEM_PROMPT = `Bạn là trợ lý DeployBox (nền tảng tự deploy) trả lời người dùng qua Telegram.
Người dùng hỏi về project/deploy của HỌ. Bạn được cấp DỮ LIỆU THẬT về các project họ có quyền xem
(tên, trạng thái, lỗi gần nhất, chẩn đoán AI nếu có).

Quy tắc:
- CHỈ dựa vào dữ liệu được cấp. Không bịa. Thiếu dữ liệu → nói thẳng và gợi ý mở trang deployment xem log.
- Trả lời NGẮN GỌN (tối đa ~10 dòng), tiếng Việt, thân thiện, plain text (KHÔNG markdown, không backtick).
- Hỏi về lỗi deploy → dùng errorMessage + chẩn đoán AI có sẵn trong dữ liệu.
- Không bao giờ tiết lộ giá trị biến môi trường, token, mật khẩu.
- Câu hỏi ngoài phạm vi DeployBox/deploy → từ chối nhẹ nhàng, nói bạn chỉ hỗ trợ về deploy.`;

export interface DiagnoseInput {
  projectId?: string; // để khớp "trí nhớ sửa lỗi" theo project
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


  /** Gọi provider + ghi nhật ký token (best-effort, flag ai_usage_tracking) → trả data. */
  private async run(
    feature: string,
    provider: LlmProvider,
    model: string,
    opts: { system: string; user: string; schema: Record<string, unknown> },
  ): Promise<Record<string, unknown>> {
    const res = await provider.complete({ model, ...opts });
    if (this.flags.aiEnabled('ai_usage_tracking')) {
      void this.prisma.aiUsage
        .create({
          data: {
            feature,
            provider: provider.id,
            model,
            inputTokens: res.inputTokens,
            outputTokens: res.outputTokens,
          },
        })
        .catch(() => undefined);
    }
    return res.data;
  }

  /** Như run() nhưng kèm 1 ảnh (vision). */
  private async runVision(
    feature: string,
    provider: LlmProvider,
    model: string,
    opts: { system: string; user: string; schema: Record<string, unknown>; imageBase64: string; imageMime: string },
  ): Promise<Record<string, unknown>> {
    const res = await provider.completeVision({ model, ...opts });
    if (this.flags.aiEnabled('ai_usage_tracking')) {
      void this.prisma.aiUsage
        .create({
          data: {
            feature,
            provider: provider.id,
            model,
            inputTokens: res.inputTokens,
            outputTokens: res.outputTokens,
          },
        })
        .catch(() => undefined);
    }
    return res.data;
  }

  /** Provider hiện hành nếu dùng được, kèm thông báo lỗi thân thiện. */
  private async requireProvider(): Promise<{ provider: LlmProvider; model: string }> {
    if (!this.isEnabled()) {
      throw new BadRequestException('Tính năng AI đang tắt (Admin → Tính năng hệ thống).');
    }
    const cfg = await this.getConfig();
    const provider = this.providers[cfg.provider];
    if (!provider.isConfigured()) {
      throw new BadRequestException(
        `Server chưa có API key cho ${provider.label} — admin thêm key hoặc đổi nhà cung cấp.`,
      );
    }
    return { provider, model: cfg.model };
  }

  /** 💰 Tổng hợp chi phí AI theo tính năng/model (ước tính theo bảng giá public). */
  async usageSummary(days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.aiUsage.groupBy({
      by: ['feature', 'provider', 'model'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true },
    });
    const priceFor = (model: string): { in: number; out: number } => {
      const m = model.toLowerCase();
      if (m.includes('opus')) return { in: 5, out: 25 };
      if (m.includes('sonnet')) return { in: 3, out: 15 };
      if (m.includes('haiku')) return { in: 1, out: 5 };
      if (m.includes('mini')) return { in: 0.15, out: 0.6 };
      if (m.includes('gpt')) return { in: 2.5, out: 10 };
      if (m.includes('gemini')) return { in: 0.1, out: 0.4 };
      return { in: 1, out: 5 };
    };
    const items = rows
      .map((r) => {
        const inTok = r._sum.inputTokens ?? 0;
        const outTok = r._sum.outputTokens ?? 0;
        const p = priceFor(r.model);
        return {
          feature: r.feature,
          provider: r.provider,
          model: r.model,
          calls: r._count._all,
          inputTokens: inTok,
          outputTokens: outTok,
          estCostUsd: +((inTok / 1e6) * p.in + (outTok / 1e6) * p.out).toFixed(4),
        };
      })
      .sort((a, b) => b.estCostUsd - a.estCostUsd);
    return {
      days,
      items,
      totalCalls: items.reduce((s, i) => s + i.calls, 0),
      totalUsd: +items.reduce((s, i) => s + i.estCostUsd, 0).toFixed(4),
    };
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
  async diagnose(input: DiagnoseInput, feature = 'diagnosis'): Promise<AiDiagnosis> {
    if (!this.isEnabled()) {
      throw new BadRequestException(
        'Tính năng AI chẩn đoán đang tắt. Admin bật lại ở tab Admin → Tính năng hệ thống.',
      );
    }

    // 📚 Trí nhớ sửa lỗi: lỗi trùng với ca đã sửa THÀNH CÔNG → trả từ lịch sử, 0 đồng
    const remembered = await this.recallFix(input);
    if (remembered) return remembered;

    const cfg = await this.getConfig();
    const provider = this.providers[cfg.provider];
    if (!provider.isConfigured()) {
      throw new BadRequestException(
        `Chưa cấu hình API key cho ${provider.label} trên server. Thêm key vào .env rồi restart, hoặc chọn nhà cung cấp khác ở tab Admin.`,
      );
    }

    try {
      const raw = await this.run(feature, provider, cfg.model, {
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

  /** "✨ Tự nhận diện": đọc snapshot repo → đề xuất cấu hình project. */
  async analyzeRepo(input: AnalyzeRepoInput): Promise<AiProjectSuggestion> {
    if (!this.isEnabled()) {
      throw new BadRequestException(
        'Tính năng AI đang tắt. Admin bật lại ở tab Admin → Tính năng hệ thống.',
      );
    }
    const cfg = await this.getConfig();
    const provider = this.providers[cfg.provider];
    if (!provider.isConfigured()) {
      throw new BadRequestException(
        `Chưa cấu hình API key cho ${provider.label} trên server. Thêm key vào .env rồi restart, hoặc chọn nhà cung cấp khác ở tab Admin.`,
      );
    }

    const fileBlocks = Object.entries(input.files)
      .map(([path, content]) => `--- ${path} ---\n${content}`)
      .join('\n\n');
    const user = [
      `Repo: ${input.repoUrl}${input.branch ? ` (nhánh ${input.branch})` : ''}`,
      '',
      'CÂY FILE:',
      input.tree,
      '',
      'NỘI DUNG FILE CHÌA KHÓA:',
      fileBlocks || '(không đọc được file nào)',
      ...(input.hints
        ? ['', 'KẾT LUẬN ĐÃ PHÂN TÍCH SẴN (deterministic — ưu tiên tin):', input.hints]
        : []),
      '',
      'Hãy đề xuất cấu hình deploy theo schema JSON yêu cầu. Nhớ: không dùng placeholder,',
      'chỉ dùng giá trị cụ thể đọc được từ repo.',
    ].join('\n');

    try {
      const raw = await this.run('analyze', provider, cfg.model, {
        system: ANALYZE_SYSTEM_PROMPT,
        user,
        schema: SUGGESTION_SCHEMA,
      });
      return this.coerceSuggestion(raw);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`AI (${provider.id}/${cfg.model}) phân tích repo thất bại: ${msg}`);
      throw new BadRequestException(`Gọi ${provider.label} thất bại: ${msg}`);
    }
  }

  private coerceSuggestion(raw: Record<string, unknown>): AiProjectSuggestion {
    const type =
      raw.type === 'BACKEND' || raw.type === 'MOBILE' ? raw.type : ('STATIC' as const);
    const port = Number(raw.internalPort);
    const str = (v: unknown) => String(v ?? '').trim();
    return {
      type,
      framework: str(raw.framework),
      rootDir: str(raw.rootDir) || '.',
      installCommand: str(raw.installCommand),
      buildCommand: str(raw.buildCommand),
      startCommand: str(raw.startCommand),
      outputDir: str(raw.outputDir),
      internalPort:
        Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0,
      buildImage: str(raw.buildImage),
      artifactPath: str(raw.artifactPath),
      envKeys: Array.isArray(raw.envKeys)
        ? raw.envKeys.filter((k): k is string => typeof k === 'string').slice(0, 30)
        : [],
      reason: str(raw.reason),
      apps: Array.isArray(raw.apps)
        ? (raw.apps as Record<string, unknown>[]).slice(0, 6).map((a) => {
            const p = Number(a.internalPort);
            return {
              name: str(a.name) || 'app',
              type: a.type === 'BACKEND' || a.type === 'MOBILE' ? a.type : ('STATIC' as const),
              rootDir: str(a.rootDir) || '.',
              buildCommand: str(a.buildCommand),
              startCommand: str(a.startCommand),
              outputDir: str(a.outputDir),
              internalPort: Number.isInteger(p) && p > 0 && p <= 65535 ? p : 0,
            };
          })
        : [],
    };
  }

  /** Sinh Dockerfile khi repo không có (project Docker mode). Trả về nội dung Dockerfile. */
  async generateDockerfile(input: {
    projectName: string;
    internalPort: number;
    startCommand?: string | null;
    tree: string; // cây file của repo đã clone
    files: Record<string, string>; // package.json, requirements.txt…
  }): Promise<string> {
    if (!this.isEnabled()) {
      throw new BadRequestException('Tính năng AI đang tắt (Admin → Tính năng hệ thống).');
    }
    const cfg = await this.getConfig();
    const provider = this.providers[cfg.provider];
    if (!provider.isConfigured()) {
      throw new BadRequestException(`Server chưa có API key cho ${provider.label}.`);
    }
    const fileBlocks = Object.entries(input.files)
      .map(([p, c]) => `--- ${p} ---\n${c}`)
      .join('\n\n');
    try {
      const raw = await this.run('dockerfile', provider, cfg.model, {
        system: [
          'Bạn là kỹ sư DevOps. Sinh Dockerfile PRODUCTION cho repo dưới đây.',
          'Quy tắc:',
          '- Multi-stage (build stage + runtime stage nhỏ gọn, vd node:lts-alpine).',
          '- COPY package*.json trước rồi mới COPY source (tận dụng layer cache).',
          '- Node: cài đủ devDependencies để build (npm ci --include=dev), stage runtime chỉ production deps.',
          '- Project dùng Prisma: chạy "npx prisma generate" trước build, COPY thư mục prisma vào runtime stage.',
          `- EXPOSE đúng port app lắng nghe (project này: ${input.internalPort}).`,
          input.startCommand ? `- CMD dựa theo lệnh chạy thật: ${input.startCommand}` : '- CMD theo script start trong package.json.',
          '- CHỈ dùng base image công khai có thật. Không bịa. Không giải thích ngoài JSON.',
        ].join('\n'),
        user: [
          `Project: ${input.projectName}`,
          '',
          'CÂY FILE:',
          input.tree,
          '',
          'FILE CHÌA KHÓA:',
          fileBlocks || '(không có)',
        ].join('\n'),
        schema: {
          type: 'object',
          properties: {
            dockerfile: { type: 'string', description: 'Toàn bộ nội dung Dockerfile.' },
          },
          required: ['dockerfile'],
          additionalProperties: false,
        },
      });
      const dockerfile = String(raw.dockerfile ?? '').trim();
      if (!dockerfile.toUpperCase().includes('FROM ')) {
        throw new Error('AI không trả về Dockerfile hợp lệ');
      }
      return dockerfile;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`AI sinh Dockerfile thất bại: ${msg}`);
      throw new BadRequestException(`Gọi ${provider.label} thất bại: ${msg}`);
    }
  }

  /** Tóm tắt build log dài thành vài dòng tiếng Việt (dùng cho nút "Tóm tắt"). */
  async summarizeLog(projectName: string, logText: string): Promise<string> {
    if (!this.isEnabled()) {
      throw new BadRequestException('Tính năng AI đang tắt (Admin → Tính năng hệ thống).');
    }
    const cfg = await this.getConfig();
    const provider = this.providers[cfg.provider];
    if (!provider.isConfigured()) {
      throw new BadRequestException(
        `Server chưa có API key cho ${provider.label} — admin thêm key hoặc đổi nhà cung cấp.`,
      );
    }
    const MAX = 20_000;
    const log =
      logText.length > MAX
        ? logText.slice(0, 6_000) + '\n...(lược bớt giữa)...\n' + logText.slice(-14_000)
        : logText;
    try {
      const raw = await this.run('summary', provider, cfg.model, {
        system:
          'Bạn là kỹ sư DevOps. Tóm tắt build/deploy log thành 3–6 dòng tiếng Việt, plain text: ' +
          'diễn biến chính theo thứ tự, thời điểm đáng chú ý (cài đặt, build, chạy), cảnh báo/lỗi nếu có. Không bịa.',
        user: `Project: ${projectName}\n\nLOG:\n${log}\n\nTóm tắt theo schema JSON.`,
        schema: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'Tóm tắt 3–6 dòng tiếng Việt, plain text.' },
          },
          required: ['summary'],
          additionalProperties: false,
        },
      });
      const summary = String(raw.summary ?? '').trim();
      if (!summary) throw new Error('AI không trả về tóm tắt');
      return summary;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`AI tóm tắt log thất bại: ${msg}`);
      throw new BadRequestException(`Gọi ${provider.label} thất bại: ${msg}`);
    }
  }

  /** Hỏi đáp tự do (Telegram bot): trả lời dựa trên dữ liệu project của user. */
  async answer(question: string, context: string): Promise<string> {
    if (!this.isEnabled()) {
      throw new BadRequestException('Tính năng AI đang tắt (Admin → Tính năng hệ thống).');
    }
    const cfg = await this.getConfig();
    const provider = this.providers[cfg.provider];
    if (!provider.isConfigured()) {
      throw new BadRequestException(
        `Server chưa có API key cho ${provider.label} — admin thêm key hoặc đổi nhà cung cấp.`,
      );
    }
    try {
      const raw = await this.run('answer', provider, cfg.model, {
        system: ANSWER_SYSTEM_PROMPT,
        user: [
          'DỮ LIỆU PROJECT CỦA NGƯỜI DÙNG:',
          context,
          '',
          `CÂU HỎI: ${question}`,
        ].join('\n'),
        schema: ANSWER_SCHEMA,
      });
      const answer = String(raw.answer ?? '').trim();
      if (!answer) throw new Error('AI không trả về câu trả lời');
      return answer;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`AI (${cfg.provider}/${cfg.model}) trả lời thất bại: ${msg}`);
      throw new BadRequestException(`Gọi ${provider.label} thất bại: ${msg}`);
    }
  }

  /** 🖼 Đọc ảnh lỗi (bot Telegram): chẩn đoán từ ảnh chụp màn hình. */
  async analyzeImage(
    question: string,
    context: string,
    imageBase64: string,
    imageMime: string,
  ): Promise<string> {
    const { provider, model } = await this.requireProvider();
    try {
      const raw = await this.runVision('photo', provider, model, {
        system:
          'Bạn là kỹ sư DevOps. Người dùng gửi ẢNH chụp màn hình (log lỗi, trang lỗi, terminal…). ' +
          'Đọc kỹ nội dung trong ảnh → chẩn đoán vấn đề + cách xử lý, tiếng Việt, ngắn gọn (~8 dòng), plain text. ' +
          'Ảnh không liên quan lỗi/kỹ thuật → nói thẳng là không thấy lỗi gì trong ảnh. Không bịa.',
        user: [
          context ? `DỮ LIỆU PROJECT CỦA NGƯỜI DÙNG:\n${context}\n` : '',
          `CÂU HỎI KÈM ẢNH: ${question || 'Ảnh này bị lỗi gì và sửa thế nào?'}`,
        ].join('\n'),
        schema: {
          type: 'object',
          properties: { answer: { type: 'string', description: 'Chẩn đoán + cách sửa, tiếng Việt, plain text.' } },
          required: ['answer'],
          additionalProperties: false,
        },
        imageBase64,
        imageMime,
      });
      const answer = String(raw.answer ?? '').trim();
      if (!answer) throw new Error('AI không trả về câu trả lời');
      return answer;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`AI đọc ảnh thất bại: ${msg}`);
      throw new BadRequestException(`Gọi ${provider.label} thất bại: ${msg}`);
    }
  }

  /** 📝 Release notes: tóm tắt danh sách commit thành changelog tiếng Việt. */
  async releaseNotes(projectName: string, commits: string[]): Promise<string> {
    const { provider, model } = await this.requireProvider();
    try {
      const raw = await this.run('release_notes', provider, model, {
        system:
          'Bạn viết release notes tiếng Việt từ danh sách commit. Gọn, dễ hiểu cho người không code. ' +
          'Nhóm theo: ✨ Tính năng mới / 🐛 Sửa lỗi / 🔧 Khác (bỏ nhóm rỗng). ' +
          'Mỗi dòng 1 gạch đầu dòng, gộp commit trùng ý, bỏ commit vô nghĩa (wip, typo…). Plain text.',
        user: `Project: ${projectName}\n\nCOMMITS (mới → cũ):\n${commits.join('\n').slice(0, 8_000)}`,
        schema: {
          type: 'object',
          properties: { notes: { type: 'string', description: 'Release notes tiếng Việt, plain text.' } },
          required: ['notes'],
          additionalProperties: false,
        },
      });
      const notes = String(raw.notes ?? '').trim();
      if (!notes) throw new Error('AI không trả về nội dung');
      return notes;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(`Gọi ${provider.label} thất bại: ${msg}`);
    }
  }

  /** ⚙️ Sinh GitHub Actions workflow gọi API deploy của project. */
  async generateCi(input: {
    projectName: string;
    branch: string;
    apiUrl: string;
    projectId: string;
  }): Promise<string> {
    const { provider, model } = await this.requireProvider();
    try {
      const raw = await this.run('ci_generator', provider, model, {
        system:
          'Bạn là kỹ sư DevOps. Sinh file GitHub Actions workflow YAML hợp lệ, chú thích tiếng Việt. ' +
          'KHÔNG bịa secret — dùng đúng ${{ secrets.DEPLOYBOX_TOKEN }}. Chỉ trả YAML trong field json.',
        user: [
          `Sinh workflow cho project "${input.projectName}":`,
          `- Kích hoạt: push lên nhánh "${input.branch}"`,
          `- Việc duy nhất: gọi API deploy của DeployBox:`,
          `  curl -f -X POST "${input.apiUrl}/api/v1/projects/${input.projectId}/deploy" \\`,
          `    -H "Authorization: Bearer \${{ secrets.DEPLOYBOX_TOKEN }}"`,
          `- Thêm chú thích hướng dẫn: tạo token ở DeployBox → Settings → API Tokens,`,
          `  rồi thêm vào GitHub repo → Settings → Secrets với tên DEPLOYBOX_TOKEN.`,
        ].join('\n'),
        schema: {
          type: 'object',
          properties: { yaml: { type: 'string', description: 'Nội dung file .github/workflows/deploy.yml' } },
          required: ['yaml'],
          additionalProperties: false,
        },
      });
      const yaml = String(raw.yaml ?? '').trim();
      if (!yaml.includes('on:')) throw new Error('AI không trả về workflow hợp lệ');
      return yaml;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(`Gọi ${provider.label} thất bại: ${msg}`);
    }
  }

  /** 🤖 Copilot: 1 lượt chat — trả lời + (tuỳ) đề xuất hành động cần user xác nhận. */
  async copilotTurn(params: {
    question: string;
    history: string; // các lượt trước, dạng text
    context: string; // dữ liệu project user có quyền xem
    onboarding: boolean;
  }): Promise<{ reply: string; action: 'none' | 'deploy' | 'stop'; projectSlug: string }> {
    const { provider, model } = await this.requireProvider();
    const base =
      'Bạn là Copilot của DeployBox (nền tảng tự deploy), chat trong dashboard. ' +
      'CHỈ dựa vào DỮ LIỆU PROJECT được cấp — không bịa. Trả lời tiếng Việt, ngắn gọn, plain text. ' +
      'Không lộ giá trị env/token/mật khẩu. ' +
      'Nếu user muốn deploy lại / tắt app: KHÔNG tự làm — đặt action="deploy"|"stop" + projectSlug đúng, ' +
      'reply giải thích ngắn; hệ thống sẽ hiện nút xác nhận. Không chắc app nào → hỏi lại, action="none".';
    const onboardingExtra =
      ' NGƯỜI DÙNG MỚI (chưa có project): dẫn từng bước một — 1) chuẩn bị repo GitHub, ' +
      '2) vào "Tạo project" dán repo URL + bấm "✨ Tự nhận diện cấu hình (AI)", 3) bấm Tạo rồi Deploy, ' +
      '4) xem log/domain ở trang project. Mỗi lượt chỉ hướng dẫn 1 bước, hỏi lại khi xong.';
    try {
      const raw = await this.run('copilot', provider, model, {
        system: base + (params.onboarding ? onboardingExtra : ''),
        user: [
          'DỮ LIỆU PROJECT:',
          params.context || '(chưa có project nào)',
          '',
          params.history ? `HỘI THOẠI TRƯỚC:\n${params.history}\n` : '',
          `NGƯỜI DÙNG: ${params.question}`,
        ].join('\n'),
        schema: {
          type: 'object',
          properties: {
            reply: { type: 'string', description: 'Câu trả lời tiếng Việt, plain text.' },
            action: { type: 'string', enum: ['none', 'deploy', 'stop'], description: 'Hành động đề xuất (cần user xác nhận).' },
            projectSlug: { type: 'string', description: 'Slug project cho action; "" nếu action=none.' },
          },
          required: ['reply', 'action', 'projectSlug'],
          additionalProperties: false,
        },
      });
      const action = raw.action === 'deploy' || raw.action === 'stop' ? raw.action : 'none';
      return {
        reply: String(raw.reply ?? '').trim() || 'Mình chưa hiểu ý bạn, nói rõ hơn nhé?',
        action,
        projectSlug: action === 'none' ? '' : String(raw.projectSlug ?? '').trim(),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(`Gọi ${provider.label} thất bại: ${msg}`);
    }
  }

  /** Bản "best-effort": trả null thay vì ném lỗi (dùng ở đường nền — notify, webhook). */
  async tryDiagnose(input: DiagnoseInput, feature = 'diagnosis'): Promise<AiDiagnosis | null> {
    try {
      return await this.diagnose(input, feature);
    } catch {
      return null;
    }
  }

  /** 📚 Tìm trong trí nhớ: lỗi cùng chữ ký đã có cách sửa ĐÃ CHỨNG MINH chưa. */
  private async recallFix(input: DiagnoseInput): Promise<AiDiagnosis | null> {
    if (!this.flags.aiEnabled('ai_fix_memory')) return null;
    try {
      const sig = errorSig(input.errorMessage, input.log);
      // Ưu tiên bản ghi cùng project, rồi tới bản ghi chung
      const hit = await this.prisma.fixMemory.findFirst({
        where: { errorSig: sig, verified: true },
        orderBy: [{ projectId: input.projectId ? 'desc' : 'asc' }, { hits: 'desc' }],
      });
      if (!hit) return null;
      await this.prisma.fixMemory.update({
        where: { id: hit.id },
        data: { hits: { increment: 1 } },
      });
      this.logger.log(`📚 Trí nhớ sửa lỗi khớp (sig ${sig.slice(0, 8)}, hits ${hit.hits + 1}) — không gọi AI.`);
      return {
        cause: hit.cause,
        fix: `${hit.fix}\n\n📚 Lỗi này từng gặp và đã sửa THÀNH CÔNG bằng cách trên (dùng lại lần thứ ${hit.hits + 1}).`,
        commands: [],
        configField: (hit.configField as AiDiagnosis['configField']) ?? 'none',
        configValue: hit.configValue ?? '',
        confidence: 'cao',
        model: '📚 Trí nhớ DeployBox (0 đồng)',
        createdAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  /**
   * 📚 Học: gọi khi deploy THÀNH CÔNG ngay sau 1 bản FAILED có chẩn đoán —
   * tức là cách sửa đó đã hiệu quả → lưu (chữ ký lỗi → cách sửa) verified.
   */
  async learnFix(params: {
    projectId: string;
    errorMessage: string | null;
    logTail: string;
    diagnosis: AiDiagnosis;
  }): Promise<void> {
    if (!this.flags.aiEnabled('ai_fix_memory')) return;
    try {
      const sig = errorSig(params.errorMessage, params.logTail);
      const existing = await this.prisma.fixMemory.findFirst({
        where: { errorSig: sig, projectId: params.projectId },
      });
      if (existing) {
        await this.prisma.fixMemory.update({
          where: { id: existing.id },
          data: { verified: true, cause: params.diagnosis.cause, fix: params.diagnosis.fix },
        });
      } else {
        await this.prisma.fixMemory.create({
          data: {
            projectId: params.projectId,
            errorSig: sig,
            cause: params.diagnosis.cause,
            fix: params.diagnosis.fix,
            configField:
              params.diagnosis.configField === 'none' ? null : params.diagnosis.configField,
            configValue: params.diagnosis.configValue || null,
            verified: true,
          },
        });
      }
      this.logger.log(`📚 Đã học cách sửa lỗi (sig ${sig.slice(0, 8)}) từ ca fail→thành công.`);
    } catch {
      /* best-effort */
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
