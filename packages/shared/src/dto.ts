// DTO phản hồi dùng chung FE + BE (xem implementation/02-api-contract.md §3)
import type {
  DeploymentStatus,
  DeploymentTrigger,
  DomainStatus,
  EnvTarget,
  ProjectType,
  ServerStatus,
  ServerType,
  TeamRole,
} from './enums';

export interface UserDto {
  id: string;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface TeamDto {
  id: string;
  name: string;
  slug: string;
  role: TeamRole;
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
