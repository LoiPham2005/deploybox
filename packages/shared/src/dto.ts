// DTO phản hồi dùng chung FE + BE (xem implementation/02-api-contract.md §3)
import type {
  DeploymentStatus,
  DeploymentTrigger,
  DomainStatus,
  EnvTarget,
  Plan,
  ProjectType,
  ServerStatus,
  ServerType,
  TeamRole,
  UserRole,
} from './enums';

export interface UserDto {
  id: string;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
  role?: UserRole;
}

export interface TeamDto {
  id: string;
  name: string;
  slug: string;
  role: TeamRole;
  plan: Plan;
  isPersonal: boolean;
}

export interface AuthResponse {
  user: UserDto;
  accessToken: string;
}

export interface MeResponse {
  user: UserDto;
  teams: TeamDto[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
  type: ProjectType;
  primaryDomain?: string;
  latestDeployment?: {
    id: string;
    status: DeploymentStatus;
    createdAt: string;
  };
}

/** Nhà cung cấp AI được hỗ trợ. */
export type AiProviderId = 'anthropic' | 'openai' | 'gemini';

/** Trạng thái cấu hình AI (cho trang Admin chọn provider + model). */
export interface AiConfigStatus {
  provider: AiProviderId; // provider đang chọn dùng toàn app
  model: string; // model đang chọn
  providers: Array<{
    id: AiProviderId;
    label: string; // "Claude", "ChatGPT", "Gemini"
    configured: boolean; // đã có API key trong .env chưa
    suggestedModels: string[]; // gợi ý model (vẫn cho gõ tự do)
  }>;
}

/** Kết quả AI "bác sĩ lỗi deploy" — đọc log thất bại, chỉ nguyên nhân + cách sửa. */
export interface AiDiagnosis {
  cause: string; // Nguyên nhân gốc (tiếng Việt)
  fix: string; // Cách sửa (tiếng Việt)
  commands: string[]; // Lệnh / đoạn config cần chạy hoặc sửa (có thể rỗng)
  // Trường cấu hình project nên sửa (để sau có thể auto-apply), 'none' nếu không có
  configField:
    | 'installCommand'
    | 'buildCommand'
    | 'startCommand'
    | 'outputDir'
    | 'internalPort'
    | 'rootDir'
    | 'artifactPath'
    | 'none';
  configValue: string; // Giá trị đề xuất cho configField ('' nếu none)
  confidence: 'cao' | 'trung bình' | 'thấp';
  model: string; // Model đã dùng
  createdAt: string; // ISO time chẩn đoán
}

export interface DeploymentDetail {
  id: string;
  projectId: string;
  status: DeploymentStatus;
  trigger: DeploymentTrigger;
  commitSha?: string | null;
  commitMsg?: string | null;
  queuedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  errorMessage?: string | null;
  aiDiagnosis?: AiDiagnosis | null;
}

export interface AddDomainResponse {
  domain: { id: string; hostname: string; status: DomainStatus };
  dnsInstructions: {
    type: 'A' | 'CNAME';
    name: string;
    value: string;
  };
  verification?: { type: 'TXT'; name: string; value: string };
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProjectDomainDto {
  id: string;
  hostname: string;
  isPrimary: boolean;
  status: DomainStatus;
}

export interface ProjectDetailDto {
  id: string;
  teamId: string;
  name: string;
  slug: string;
  type: ProjectType;
  gitRepoUrl?: string | null;
  gitBranch: string;
  rootDir: string;
  hasGitToken: boolean;
  installCommand?: string | null;
  buildCommand?: string | null;
  startCommand?: string | null;
  outputDir?: string | null;
  internalPort: number;
  buildImage?: string | null;
  artifactPath?: string | null;
  autoDeploy: boolean;
  sleepEnabled: boolean;
  useDocker: boolean;
  memoryMb: number;
  cpuLimit: number;
  notifyUrl?: string | null;
  serverId?: string | null;
  domains: ProjectDomainDto[];
  deployments: DeploymentDetail[];
  webhookUrl: string;
  webhookSecret?: string | null;
  createdAt: string;
}

export interface DeploymentView {
  deployment: DeploymentDetail;
  project: { id: string; name: string; slug: string; type: ProjectType };
  url?: string | null;         // URL phục vụ khi RUNNING (web tĩnh / backend)
  artifactUrl?: string | null; // URL tải file khi RUNNING (mobile APK/AAB)
  logs: string;
}

export interface EnvVarDto {
  key: string;
  value: string; // rỗng nếu là secret (không lộ giá trị)
  isSecret: boolean;
  target: EnvTarget;
}

export interface WebhookEventDto {
  id: string;
  source: string;
  branch?: string | null;
  commitSha?: string | null;
  status: string;
  reason?: string | null;
  createdAt: string;
}

export interface TeamMemberDto {
  id: string;
  userId: string;
  email: string;
  name?: string | null;
  role: TeamRole;
  joinedAt: string;
}

export interface ApiTokenDto {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string | null;
}

export interface ServerDto {
  id: string;
  teamId: string;
  name: string;
  host: string;
  port: number;
  username: string;
  type: ServerType;
  status: ServerStatus;
  createdAt: string;
}
