'use server';

import { revalidatePath } from 'next/cache';
import {
  createProjectSchema,
  updateProjectSchema,
  upsertEnvSchema,
  type AddDomainResponse,
  type AiDiagnosis,
  type AiProjectSuggestion,
  type ProjectCheckResult,
  type CreateProjectDto,
  type DeploymentDetail,
  type ProjectSummary,
  type UpdateProjectDto,
  type UpsertEnvDto,
} from '@deploybox/shared';
import { serverApi } from '@/lib/api-server';

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export interface RemoteBranch {
  name: string;
  lastCommitAt: string | null;
}

/** Repos của user qua danh tính OAuth đã kết nối (picker tạo project). */
export async function listOauthReposAction(
  provider: string,
): Promise<ActionResult<import('@deploybox/shared').GitRepoDto[]>> {
  try {
    const repos = await serverApi<import('@deploybox/shared').GitRepoDto[]>(
      `/auth/oauth/${provider}/repos`,
    );
    return { ok: true, data: repos };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Không tải được danh sách repo' };
  }
}

/** Tự tạo webhook cho project vừa tạo từ repo picker (best-effort). */
export async function setupOauthWebhookAction(
  provider: string,
  projectId: string,
): Promise<ActionResult> {
  try {
    await serverApi(`/auth/oauth/${provider}/setup-webhook`, {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Tạo webhook thất bại' };
  }
}

export async function createProjectAction(
  teamId: string,
  input: CreateProjectDto,
): Promise<ActionResult<ProjectSummary>> {
  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Dữ liệu không hợp lệ' };
  }
  try {
    const project = await serverApi<ProjectSummary>(
      `/teams/${teamId}/projects`,
      { method: 'POST', body: JSON.stringify(parsed.data) },
    );
    revalidatePath('/dashboard');
    return { ok: true, data: project };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Tạo project thất bại',
    };
  }
}

export async function updateProjectAction(
  projectId: string,
  input: UpdateProjectDto,
): Promise<ActionResult> {
  const parsed = updateProjectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Dữ liệu không hợp lệ' };
  }
  try {
    await serverApi(`/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(parsed.data),
    });
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Cập nhật thất bại',
    };
  }
}

export async function deployProjectAction(
  projectId: string,
): Promise<ActionResult<DeploymentDetail>> {
  try {
    const deployment = await serverApi<DeploymentDetail>(
      `/projects/${projectId}/deploy`,
      { method: 'POST' },
    );
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, data: deployment };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Deploy thất bại',
    };
  }
}

export async function deleteProjectAction(
  projectId: string,
): Promise<ActionResult> {
  try {
    await serverApi(`/projects/${projectId}`, { method: 'DELETE' });
    revalidatePath('/dashboard');
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Xóa thất bại',
    };
  }
}

export async function redeployProjectAction(
  projectId: string,
): Promise<ActionResult<DeploymentDetail>> {
  try {
    const deployment = await serverApi<DeploymentDetail>(
      `/projects/${projectId}/redeploy`,
      { method: 'POST' },
    );
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, data: deployment };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Redeploy thất bại',
    };
  }
}

export async function stopProjectAction(
  projectId: string,
): Promise<ActionResult> {
  try {
    await serverApi(`/projects/${projectId}/stop`, { method: 'POST' });
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Stop thất bại' };
  }
}

export async function sleepProjectAction(
  projectId: string,
): Promise<ActionResult> {
  try {
    await serverApi(`/projects/${projectId}/sleep`, { method: 'POST' });
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Ngủ thất bại' };
  }
}

export async function rollbackAction(
  deploymentId: string,
): Promise<ActionResult<DeploymentDetail>> {
  try {
    const deployment = await serverApi<DeploymentDetail>(
      `/deployments/${deploymentId}/rollback`,
      { method: 'POST' },
    );
    return { ok: true, data: deployment };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Rollback thất bại',
    };
  }
}

/**
 * Áp dụng cách sửa AI đề xuất: PATCH đúng 1 trường cấu hình rồi deploy lại luôn.
 * Trả về deployment mới để UI điều hướng sang theo dõi build.
 */
export async function applyAiFixAction(
  projectId: string,
  configField: string,
  configValue: string,
): Promise<ActionResult<DeploymentDetail>> {
  const ALLOWED = [
    'installCommand',
    'buildCommand',
    'startCommand',
    'outputDir',
    'internalPort',
    'rootDir',
    'artifactPath',
  ] as const;
  if (!(ALLOWED as readonly string[]).includes(configField)) {
    return { ok: false, error: 'Trường cấu hình không hợp lệ' };
  }

  // internalPort là number — các trường còn lại là string
  let value: string | number = configValue;
  if (configField === 'internalPort') {
    const port = parseInt(configValue, 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      return { ok: false, error: `Port AI đề xuất không hợp lệ: "${configValue}"` };
    }
    value = port;
  }

  const parsed = updateProjectSchema.safeParse({ [configField]: value });
  if (!parsed.success) {
    return { ok: false, error: 'Giá trị AI đề xuất không hợp lệ' };
  }

  try {
    await serverApi(`/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(parsed.data),
    });
    const deployment = await serverApi<DeploymentDetail>(
      `/projects/${projectId}/deploy`,
      { method: 'POST' },
    );
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, data: deployment };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Áp dụng cách sửa thất bại',
    };
  }
}

export async function diagnoseDeploymentAction(
  deploymentId: string,
): Promise<ActionResult<AiDiagnosis>> {
  try {
    const dep = await serverApi<DeploymentDetail>(
      `/deployments/${deploymentId}/diagnose`,
      { method: 'POST' },
    );
    return { ok: true, data: dep.aiDiagnosis ?? undefined };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'AI chẩn đoán thất bại',
    };
  }
}

export async function upsertEnvAction(
  projectId: string,
  vars: UpsertEnvDto['vars'],
): Promise<ActionResult> {
  const parsed = upsertEnvSchema.safeParse({ vars });
  if (!parsed.success) return { ok: false, error: 'Dữ liệu env không hợp lệ' };
  try {
    await serverApi(`/projects/${projectId}/env`, {
      method: 'PUT',
      body: JSON.stringify(parsed.data),
    });
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Lưu env thất bại' };
  }
}

export async function deleteEnvAction(
  projectId: string,
  key: string,
): Promise<ActionResult> {
  try {
    await serverApi(
      `/projects/${projectId}/env/${encodeURIComponent(key)}`,
      { method: 'DELETE' },
    );
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Xóa env thất bại' };
  }
}

export async function addDomainAction(
  projectId: string,
  hostname: string,
): Promise<ActionResult<AddDomainResponse>> {
  try {
    const res = await serverApi<AddDomainResponse>(
      `/projects/${projectId}/domains`,
      { method: 'POST', body: JSON.stringify({ hostname }) },
    );
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, data: res };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Thêm domain thất bại',
    };
  }
}

export async function verifyDomainAction(
  projectId: string,
  domainId: string,
): Promise<ActionResult> {
  try {
    await serverApi(`/domains/${domainId}/verify`, { method: 'POST' });
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Verify thất bại' };
  }
}

export async function deleteDomainAction(
  projectId: string,
  domainId: string,
): Promise<ActionResult> {
  try {
    await serverApi(`/domains/${domainId}`, { method: 'DELETE' });
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Xóa domain thất bại',
    };
  }
}

/** AI tóm tắt build log của 1 deployment. */
export async function summarizeDeploymentAction(
  deploymentId: string,
): Promise<ActionResult<{ summary: string }>> {
  try {
    const res = await serverApi<{ summary: string }>(
      `/deployments/${deploymentId}/summarize`,
      { method: 'POST' },
    );
    return { ok: true, data: res };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Tóm tắt thất bại' };
  }
}

/** 🔍 Kiểm tra AI trên project có sẵn: env thiếu + secret lộ (clone bằng token đã lưu). */
export async function aiCheckProjectAction(
  projectId: string,
): Promise<ActionResult<ProjectCheckResult>> {
  try {
    const res = await serverApi<ProjectCheckResult>(
      `/git/projects/${projectId}/check`,
      { method: 'POST' },
    );
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, data: res };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Kiểm tra thất bại' };
  }
}

/** 🩺 AI chẩn đoán domain kẹt DNS. */
export async function diagnoseDomainAction(
  domainId: string,
): Promise<ActionResult<{ advice: string }>> {
  try {
    const res = await serverApi<{ advice: string }>(`/domains/${domainId}/diagnose`, {
      method: 'POST',
    });
    return { ok: true, data: res };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Chẩn đoán thất bại' };
  }
}

/** 📝 AI viết release notes từ commit giữa 2 bản deploy. */
export async function releaseNotesAction(
  deploymentId: string,
): Promise<ActionResult<{ notes: string; commits: number }>> {
  try {
    const res = await serverApi<{ notes: string; commits: number }>(
      `/deployments/${deploymentId}/release-notes`,
      { method: 'POST' },
    );
    return { ok: true, data: res };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Tạo release notes thất bại' };
  }
}

/** ⚙️ AI sinh GitHub Actions workflow cho project. */
export async function generateCiAction(
  projectId: string,
): Promise<ActionResult<{ yaml: string }>> {
  try {
    const res = await serverApi<{ yaml: string }>(`/projects/${projectId}/generate-ci`, {
      method: 'POST',
    });
    return { ok: true, data: res };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Sinh file CI thất bại' };
  }
}

/** 💡 AI gợi ý vận hành (sleep/chọn server) từ lịch sử truy cập. */
export async function opsAdviceAction(
  projectId: string,
): Promise<ActionResult<{ advice: string }>> {
  try {
    const res = await serverApi<{ advice: string }>(`/projects/${projectId}/ops-advice`);
    return { ok: true, data: res };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Lấy gợi ý thất bại' };
  }
}

/** ✨ AI đọc repo → đề xuất cấu hình deploy (type, build/start command, port…). */
export async function analyzeRepoAction(
  repoUrl: string,
  gitToken?: string,
  branch?: string,
  authMode?: string,
  gitUsername?: string,
): Promise<ActionResult<AiProjectSuggestion>> {
  try {
    const suggestion = await serverApi<AiProjectSuggestion>('/git/analyze', {
      method: 'POST',
      body: JSON.stringify({
        repoUrl,
        gitToken: gitToken || undefined,
        branch: branch || undefined,
        authMode: authMode || 'auto',
        gitUsername: gitUsername || undefined,
      }),
    });
    return { ok: true, data: suggestion };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'AI phân tích repo thất bại',
    };
  }
}

export async function fetchBranchesAction(
  repoUrl: string,
  gitToken?: string,
  authMode?: string,
  gitUsername?: string,
): Promise<ActionResult<RemoteBranch[]>> {
  try {
    const res = await serverApi<{ branches: RemoteBranch[] }>('/git/branches', {
      method: 'POST',
      body: JSON.stringify({
        repoUrl,
        gitToken: gitToken || undefined,
        authMode: authMode || 'auto',
        gitUsername: gitUsername || undefined,
      }),
    });
    return { ok: true, data: res.branches };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Không lấy được branches' };
  }
}

/** Lấy branches cho project đã tồn tại — dùng token đã lưu, không cần nhập lại. */
export async function fetchProjectBranchesAction(
  projectId: string,
): Promise<ActionResult<RemoteBranch[]>> {
  try {
    const res = await serverApi<{ branches: RemoteBranch[] }>(
      `/git/projects/${projectId}/branches`,
      { method: 'POST' },
    );
    return { ok: true, data: res.branches };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Không lấy được branches' };
  }
}

export async function setPrimaryDomainAction(
  projectId: string,
  domainId: string,
): Promise<ActionResult> {
  try {
    await serverApi(`/domains/${domainId}/set-primary`, { method: 'POST' });
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Đặt domain chính thất bại',
    };
  }
}
