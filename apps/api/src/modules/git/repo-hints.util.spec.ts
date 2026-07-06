import { describe, it, expect } from 'vitest';
import { buildRepoHints } from './repo-hints.util';

describe('buildRepoHints (phân tích repo không cần AI)', () => {
  it('Next standalone → gợi ý đúng 2 lệnh + port 3000', () => {
    const h = buildRepoHints('next.config.mjs\npackage-lock.json', {
      'next.config.mjs': `export default { output: 'standalone' }`,
      'package.json': '{"dependencies":{"next":"14.0.0"}}',
    });
    expect(h).toContain('standalone');
    expect(h).toContain('node .next/standalone/server.js');
    expect(h).toContain('npm ci');
  });

  it('NestJS + prisma ngoài src → dist/src/main', () => {
    const h = buildRepoHints('nest-cli.json\nprisma/schema.prisma\npnpm-lock.yaml', {
      'package.json': '{"dependencies":{"@nestjs/core":"10"},"scripts":{"build":"nest build","start:prod":"node dist/main"}}',
      'prisma/schema.prisma': 'datasource db {}',
    });
    expect(h).toContain('dist/src/main');
    expect(h).toContain('prisma generate');
    expect(h).toContain('pnpm install');
    expect(h).toContain('"start:prod"');
  });

  it('Next export → STATIC out', () => {
    const h = buildRepoHints('next.config.js', {
      'next.config.js': `module.exports = { output: 'export' }`,
    });
    expect(h).toContain('STATIC');
  });

  it('repo lạ → chuỗi rỗng (không bịa)', () => {
    expect(buildRepoHints('README.md', {})).toBe('');
  });
});
