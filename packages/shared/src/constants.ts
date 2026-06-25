export const PLAN_LIMITS = {
  FREE: { projects: 2, servers: 1, members: 3 },
  PRO:  { projects: -1, servers: -1, members: -1 }, // -1 = không giới hạn
} as const;

export type PlanLimits = typeof PLAN_LIMITS[keyof typeof PLAN_LIMITS];
