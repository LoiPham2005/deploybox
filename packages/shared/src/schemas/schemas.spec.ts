import { describe, it, expect } from 'vitest';
import {
  addDomainSchema,
  createProjectSchema,
  registerSchema,
  upsertEnvSchema,
} from './index';
import { DeploymentStatus, ProjectType } from '../enums';

describe('shared schemas', () => {
  it('createProjectSchema: hợp lệ + áp default', () => {
    const r = createProjectSchema.parse({ name: 'My App', type: 'STATIC' });
    expect(r.gitBranch).toBe('main');
    expect(r.rootDir).toBe('.');
  });

  it('createProjectSchema: từ chối type sai', () => {
    expect(
      createProjectSchema.safeParse({ name: 'x', type: 'WEIRD' }).success,
    ).toBe(false);
  });

  it('createProjectSchema: từ chối gitRepoUrl không phải URL', () => {
    expect(
      createProjectSchema.safeParse({
        name: 'x',
        type: 'STATIC',
        gitRepoUrl: 'not-a-url',
      }).success,
    ).toBe(false);
  });

  it('registerSchema: mật khẩu < 8 bị từ chối', () => {
    expect(
      registerSchema.safeParse({ email: 'a@b.com', password: 'short' }).success,
    ).toBe(false);
  });

  it('registerSchema: email sai bị từ chối', () => {
    expect(
      registerSchema.safeParse({ email: 'not-email', password: 'longenough' })
        .success,
    ).toBe(false);
  });

  it('upsertEnvSchema: key phải UPPER_SNAKE_CASE', () => {
    expect(
      upsertEnvSchema.safeParse({ vars: [{ key: 'lower', value: 'x' }] })
        .success,
    ).toBe(false);
    expect(
      upsertEnvSchema.safeParse({ vars: [{ key: 'MY_KEY', value: 'x' }] })
        .success,
    ).toBe(true);
  });

  it('addDomainSchema: hostname hợp lệ / không hợp lệ', () => {
    expect(
      addDomainSchema.safeParse({ hostname: 'my-app.example.com' }).success,
    ).toBe(true);
    expect(addDomainSchema.safeParse({ hostname: 'BAD HOST' }).success).toBe(
      false,
    );
  });

  it('enums có giá trị đúng', () => {
    expect(ProjectType.STATIC).toBe('STATIC');
    expect(DeploymentStatus.RUNNING).toBe('RUNNING');
  });
});
