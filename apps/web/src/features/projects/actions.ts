'use server';

import { revalidatePath } from 'next/cache';
import {
  createProjectSchema,
  updateProjectSchema,
  upsertEnvSchema,
  type AddDomainResponse,
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

export async function fetchBranchesAction(
  repoUrl: string,
  gitToken?: string,
  authMode?: string,
  gitUsername?: string,
): Promise<ActionResult<string[]>> {
  try {
    const res = await serverApi<{ branches: string[] }>('/git/branches', {
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
