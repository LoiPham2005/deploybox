export const BUILD_QUEUE = 'build';

export interface BuildJobData {
  deploymentId: string;
  rollbackOf?: string; // nếu có: rollback về artifact của deployment này
}
