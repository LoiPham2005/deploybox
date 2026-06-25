import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự'),
  name: z.string().min(1).max(80).optional(),
  signupCode: z.string().optional(),
});
export type RegisterDto = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const updateMeSchema = z.object({
  name: z.string().min(1).max(80).optional(),
});
export type UpdateMeDto = z.infer<typeof updateMeSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự'),
});
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

export const createTokenSchema = z.object({
  name: z.string().min(1).max(60),
});
export type CreateTokenDto = z.infer<typeof createTokenSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['MEMBER']).default('MEMBER'),
});
export type InviteMemberDto = z.infer<typeof inviteMemberSchema>;

export const updateMemberRoleSchema = z.object({
  role: z.enum(['MEMBER']),
});
export type UpdateMemberRoleDto = z.infer<typeof updateMemberRoleSchema>;
