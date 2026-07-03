import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().min(1).max(60),
  type: z.enum(['STATIC', 'BACKEND', 'MOBILE']),
  gitRepoUrl: z.string().url().optional(),
  gitBranch: z.string().default('main'),
  rootDir: z.string().default('.'),
  gitToken: z.string().optional(),
  buildCommand: z.string().optional(),
  startCommand: z.string().optional(),
  outputDir: z.string().optional(),
  internalPort: z.number().int().positive().max(65535).optional(),
  buildImage: z.string().optional(),
  artifactPath: z.string().optional(),
  notifyUrl: z.string().url().optional(),
  serverId: z.string().optional(),
  useDocker: z.boolean().optional(),
  // Biến env app cần (AI đọc từ repo lúc "Tự nhận diện") — để cảnh báo thiếu env
  requiredEnvKeys: z.array(z.string().max(100)).max(30).optional(),
});
export type CreateProjectDto = z.infer<typeof createProjectSchema>;

export const upsertEnvSchema = z.object({
  vars: z.array(
    z.object({
      key: z
        .string()
        .min(1)
        .regex(/^[A-Z_][A-Z0-9_]*$/, 'Tên biến phải dạng UPPER_SNAKE_CASE'),
      value: z.string(),
      isSecret: z.boolean().default(false),
      target: z.enum(['BUILD', 'RUNTIME', 'BOTH']).default('RUNTIME'),
    }),
  ),
});
export type UpsertEnvDto = z.infer<typeof upsertEnvSchema>;

export const createDatabaseSchema = z.object({
  engine: z.enum(['POSTGRES', 'REDIS']),
  name: z.string().min(1).max(60),
  envKey: z
    .string()
    .regex(/^[A-Z_][A-Z0-9_]*$/, 'Tên biến phải UPPER_SNAKE_CASE')
    .max(100)
    .optional(),
});
export type CreateDatabaseDto = z.infer<typeof createDatabaseSchema>;

export const createCronSchema = z.object({
  name: z.string().min(1).max(60),
  schedule: z.string().min(1).max(100), // cron 5 trường; BE validate bằng parser
  command: z.string().min(1).max(1000),
  enabled: z.boolean().default(true),
});
export type CreateCronDto = z.infer<typeof createCronSchema>;

export const updateCronSchema = createCronSchema.partial();
export type UpdateCronDto = z.infer<typeof updateCronSchema>;

export const addDomainSchema = z.object({
  hostname: z
    .string()
    .min(3)
    .regex(/^[a-z0-9.-]+$/, 'Hostname không hợp lệ'),
});
export type AddDomainDto = z.infer<typeof addDomainSchema>;

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  type: z.enum(['STATIC', 'BACKEND', 'MOBILE']).optional(),
  gitRepoUrl: z.string().url().optional().or(z.literal('')),
  gitBranch: z.string().optional(),
  rootDir: z.string().optional(),
  gitToken: z.string().optional(),
  installCommand: z.string().optional(),
  buildCommand: z.string().optional(),
  startCommand: z.string().optional(),
  outputDir: z.string().optional(),
  preDeployCommand: z.string().max(1000).optional().or(z.literal('')),
  postDeployCommand: z.string().max(1000).optional().or(z.literal('')),
  internalPort: z.number().int().positive().max(65535).optional(),
  buildImage: z.string().optional(),
  artifactPath: z.string().optional(),
  sleepEnabled: z.boolean().optional(),
  autoDeploy: z.boolean().optional(),
  useDocker: z.boolean().optional(),
  previewEnabled: z.boolean().optional(),
  notifyUrl: z.string().url().optional().or(z.literal('')),
});
export type UpdateProjectDto = z.infer<typeof updateProjectSchema>;
