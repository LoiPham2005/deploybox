import { serverGet } from '@/lib/api-server';
import { Card } from '@/components/ui/card';
import { ApiTokensManager } from '@/features/auth/api-tokens-manager';

export default async function TokensPage() {
  const tokens = await serverGet.tokens().catch(() => []);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold">API Tokens</h1>
        <p className="mt-1 text-sm text-white/40">
          Dùng token để deploy từ CI/CD (GitHub Actions, GitLab CI…) mà không cần mật khẩu.
        </p>
      </div>

      <Card>
        <ApiTokensManager initialTokens={tokens} />
      </Card>
    </div>
  );
}
