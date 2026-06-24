import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET phải >= 8 ký tự'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY phải >= 32 ký tự'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  APP_DOMAIN: z.string().default('localhost'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  DATA_DIR: z.string().default('.deploybox-data'),
  PUBLIC_API_URL: z.string().default('http://localhost:4000'),
  CADDY_ADMIN_URL: z.string().default('http://localhost:2019'),
  PROXY_PORT: z.string().default('8080'),
});

export type AppEnv = z.infer<typeof envSchema>;

/** Validate biến môi trường lúc khởi động (dùng cho @nestjs/config). */
export function validateEnv(config: Record<string, unknown>): AppEnv {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const errors = JSON.stringify(parsed.error.flatten().fieldErrors, null, 2);
    throw new Error(`Cấu hình .env không hợp lệ:\n${errors}`);
  }
  return parsed.data;
}
