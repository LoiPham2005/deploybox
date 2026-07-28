'use client';

import { useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { FileKey, Upload } from 'lucide-react';
import type { SecretFileDto } from '@deploybox/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { upsertSecretFileAction, deleteSecretFileAction } from './actions';

const MAX = 512 * 1024;

export function SecretFilesManager({
  projectId,
  rootDir,
  files,
}: {
  projectId: string;
  rootDir: string;
  files: SecretFileDto[];
}) {
  const router = useRouter();
  const [path, setPath] = useState('');
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > MAX) {
      setErr('File tối đa 512KB');
      return;
    }
    setErr(null);
    setFileName(f.name);
    if (!path) setPath(f.name); // gợi ý path = tên file
    const reader = new FileReader();
    reader.onload = () => setContent(String(reader.result ?? ''));
    reader.readAsText(f);
  }

  async function save() {
    if (!path.trim() || !content) {
      setErr('Chọn file + nhập đường dẫn.');
      return;
    }
    setSaving(true);
    setErr(null);
    setMsg(null);
    const res = await upsertSecretFileAction(projectId, path.trim(), content);
    setSaving(false);
    if (res.ok) {
      setMsg('Đã lưu. Deploy lại để ghi vào app.');
      setPath('');
      setContent('');
      setFileName('');
      router.refresh();
    } else {
      setErr(res.error);
    }
  }

  async function del(p: string) {
    const ok = await confirm({
      title: 'Xoá tệp bí mật?',
      message: `${p} — app sẽ không còn file này ở lần deploy sau.`,
      confirmText: 'Xoá',
      danger: true,
    });
    if (!ok) return;
    const res = await deleteSecretFileAction(projectId, p);
    if (res.ok) router.refresh();
    else setErr(res.error);
  }

  const dir = rootDir && rootDir !== '.' ? `${rootDir}/` : '';

  return (
    <div className="space-y-3">
      {dialog}

      {files.length > 0 && (
        <ul className="divide-y divide-white/5 rounded-lg border border-white/[0.06]">
          {files.map((f) => (
            <li key={f.path} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <FileKey size={14} className="shrink-0 text-amber-300/70" />
                <div className="min-w-0">
                  <p className="truncate font-mono text-white/80">{f.path}</p>
                  <p className="text-xs text-white/40">
                    {f.size} bytes · {new Date(f.updatedAt).toLocaleString('vi-VN')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => del(f.path)}
                className="shrink-0 text-xs text-red-400 hover:underline"
              >
                xoá
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Upload */}
      <div className="space-y-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-white/[0.06] px-2.5 py-1.5 text-xs text-white/60 hover:border-white/30 hover:text-white">
          <Upload size={13} /> Chọn file…
          <input type="file" className="hidden" onChange={onPick} />
        </label>
        {fileName && (
          <span className="ml-2 text-xs text-emerald-400">
            {fileName} ({content.length} ký tự)
          </span>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-white/60">
            Đường dẫn trong app
          </label>
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="storage/app/google-service-account.json"
            className="font-mono text-xs"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={saving}>
            {saving ? 'Đang lưu…' : 'Lưu tệp bí mật'}
          </Button>
          {msg && <span className="text-xs text-emerald-400">{msg}</span>}
          {err && <span className="text-xs text-red-400">{err}</span>}
        </div>
      </div>

      <p className="text-[11px] text-white/30">
        Khi deploy, file được ghi vào{' '}
        <code className="text-white/50">{dir}{path || '<đường dẫn>'}</code> trong app
        (mã hoá khi lưu, không đẩy git). Tham chiếu đúng path này trong code hoặc env
        (vd <code className="text-white/50">GOOGLE_APPLICATION_CREDENTIALS</code>).
      </p>
    </div>
  );
}
