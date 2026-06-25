// Enum dùng chung FE + BE — khớp 1-1 với enum trong Prisma schema
// (apps/api/prisma/schema.prisma). Dùng dạng object-as-const để vừa làm
// giá trị runtime vừa làm kiểu TypeScript.

export const TeamRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
} as const;
export type TeamRole = (typeof TeamRole)[keyof typeof TeamRole];

export const ProjectType = {
  STATIC: 'STATIC',
  BACKEND: 'BACKEND',
  MOBILE: 'MOBILE',
} as const;
export type ProjectType = (typeof ProjectType)[keyof typeof ProjectType];

export const GitProvider = {
  GITHUB: 'GITHUB',
  GITLAB: 'GITLAB',
  BITBUCKET: 'BITBUCKET',
} as const;
export type GitProvider = (typeof GitProvider)[keyof typeof GitProvider];

export const DeploymentStatus = {
  QUEUED: 'QUEUED',
  BUILDING: 'BUILDING',
  DEPLOYING: 'DEPLOYING',
  RUNNING: 'RUNNING',
  SLEEPING: 'SLEEPING',
  FAILED: 'FAILED',
  STOPPED: 'STOPPED',
  CANCELLED: 'CANCELLED',
} as const;
export type DeploymentStatus =
  (typeof DeploymentStatus)[keyof typeof DeploymentStatus];

export const DeploymentTrigger = {
  MANUAL: 'MANUAL',
  GIT_PUSH: 'GIT_PUSH',
  REDEPLOY: 'REDEPLOY',
} as const;
export type DeploymentTrigger =
  (typeof DeploymentTrigger)[keyof typeof DeploymentTrigger];

export const DomainStatus = {
  PENDING_DNS: 'PENDING_DNS',
  VERIFYING: 'VERIFYING',
  ACTIVE: 'ACTIVE',
  FAILED: 'FAILED',
} as const;
export type DomainStatus = (typeof DomainStatus)[keyof typeof DomainStatus];

export const EnvTarget = {
  BUILD: 'BUILD',
  RUNTIME: 'RUNTIME',
  BOTH: 'BOTH',
} as const;
export type EnvTarget = (typeof EnvTarget)[keyof typeof EnvTarget];

export const ServerType = {
  LOCAL: 'LOCAL',
  REMOTE: 'REMOTE',
} as const;
export type ServerType = (typeof ServerType)[keyof typeof ServerType];

export const ServerStatus = {
  UNKNOWN: 'UNKNOWN',
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
} as const;
export type ServerStatus = (typeof ServerStatus)[keyof typeof ServerStatus];
