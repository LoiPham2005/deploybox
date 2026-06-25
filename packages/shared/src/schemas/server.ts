import { z } from 'zod';

export const createServerSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(['LOCAL', 'REMOTE']),
  host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1).optional(),
  sshPrivateKey: z.string().min(1).optional(),
});
export type CreateServerDto = z.infer<typeof createServerSchema>;
