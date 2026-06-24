// DTO phản hồi dùng chung FE + BE (xem implementation/02-api-contract.md §3)
import type {
  DeploymentStatus,
  DeploymentTrigger,
  DomainStatus,
  EnvTarget,
  ProjectType,
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
  installCommand?: string | null;
  buildCommand?: string | null;
  startCommand?: string | null;
  outputDir?: string | null;
  internalPort: number;
  autoDeploy: boolean;
  sleepEnabled: boolean;
  memoryMb: number;
  cpuLimit: number;
  domains: ProjectDomainDto[];
  deployments: DeploymentDetail[];
  webhookUrl: string;
  webhookSecret?: string | null;
  createdAt: string;
}

export interface DeploymentView {
  deployment: DeploymentDetail;
  project: { id: string; name: string; slug: string; type: ProjectType };
  url?: string | null; // URL phục vụ khi RUNNING (web tĩnh)
  logs: string;
}

export interface EnvVarDto {
  key: string;
  value: string; // rỗng nếu là secret (không lộ giá trị)
  isSecret: boolean;
  target: EnvTarget;
}
