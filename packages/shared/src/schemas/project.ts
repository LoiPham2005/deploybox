import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().min(1).max(60),
  type: z.enum(['STATIC', 'BACKEND', 'MOBILE']),
  gitRepoUrl: z.string().url().optional(),
  gitBranch: z.string().default('main'),
  rootDir: z.string().default('.'),
  buildCommand: z.string().optional(),
  startCommand: z.string().optional(),
  outputDir: z.string().optional(),
  internalPort: z.number().int().positive().max(65535).optional(),
  buildImage: z.string().optional(),
  artifactPath: z.string().optional(),
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

export const addDomainSchema = z.object({
  hostname: z
    .string()
    .min(3)
    .regex(/^[a-z0-9.-]+$/, 'Hostname không hợp lệ'),
});
export type AddDomainDto = z.infer<typeof addDomainSchema>;

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  gitRepoUrl: z.string().url().optional().or(z.literal('')),
  gitBranch: z.string().optional(),
  rootDir: z.string().optional(),
  installCommand: z.string().optional(),
  buildCommand: z.string().optional(),
  startCommand: z.string().optional(),
  outputDir: z.string().optional(),
  internalPort: z.number().int().positive().max(65535).optional(),
  buildImage: z.string().optional(),
  artifactPath: z.string().optional(),
  sleepEnabled: z.boolean().optional(),
  autoDeploy: z.boolean().optional(),
});
export type UpdateProjectDto = z.infer<typeof updateProjectSchema>;
