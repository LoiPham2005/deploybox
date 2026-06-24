// Hợp đồng sự kiện WebSocket realtime (xem docs/implementation/02-api-contract.md §4)
import type { DeploymentStatus } from './enums';

export const WS_EVENTS = {
  // server -> client
  DEPLOYMENT_STATUS: 'deployment:status',
  DEPLOYMENT_LOG: 'deployment:log',
  PROJECT_UPDATED: 'project:updated',
  // client -> server
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
} as const;

export type WsEvent = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

export interface DeploymentLogEvent {
  deploymentId: string;
  line: string;
  ts: number;
  stream: 'stdout' | 'stderr';
}

export interface DeploymentStatusEvent {
  deploymentId: string;
  status: DeploymentStatus;
  at: number;
}

export interface SubscribePayload {
  room: string; // ví dụ: `deployment:${id}`
}
