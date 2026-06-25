'use client';

import { useState } from 'react';
import type { ServerDto, ServerType, TeamRole } from '@deploybox/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addServerAction, removeServerAction, testServerAction } from './actions';

const STATUS_COLOR: Record<string, string> = {
  ONLINE: 'text-emerald-400',
  OFFLINE: 'text-red-400',
  UNKNOWN: 'text-white/40',
};

const STATUS_LABEL: Record<string, string> = {
  ONLINE: 'Online',
  OFFLINE: 'Offline',
  UNKNOWN: 'Chưa kiểm tra',
};

export function ServersManager({
  teamId,
  myRole,
  initialServers,
}: {
  teamId: string;
  myRole: TeamRole;
  initialServers: ServerDto[];
}) {
  const [servers, setServers] = useState(initialServers);
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<ServerType>('REMOTE');
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('root');
  const [sshKey, setSshKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const canManage = myRole === 'OWNER';

  async function add() {
    if (!name.trim()) return;
    setSaving(true);
    setErr(null);
    const res = await addServerAction(teamId, {
      name: name.trim(),
      type,
      host: type === 'REMOTE' ? host.trim() || undefined : undefined,
      port: type === 'REMOTE' && port ? Number(port) : undefined,
      username: type === 'REMOTE' ? username.trim() || undefined : undefined,
      sshPrivateKey: type === 'REMOTE' && sshKey.trim() ? sshKey.trim() : undefined,
    });
    setSaving(false);
    if (res.ok) {
      setMsg('Đã thêm server, tải lại trang để xem');
      setShowForm(false);
      setName(''); setHost(''); setSshKey('');
      window.location.reload();
    } else {
      setErr(res.error);
    }
  }

  async function remove(id: string, svrType: string) {
    if (svrType === 'LOCAL') {
      setErr('Không thể xóa server LOCAL mặc định');
      return;
    }
    if (!confirm('Xóa server này? Các project đang dùng sẽ mất kết nối server.')) return;
    const res = await removeServerAction(id);
    if (res.ok) {
      setServers((prev) => prev.filter((s) => s.id !== id));
    } else {
      setErr(res.error);
    }
  }

  async function testConn(id: string) {
    setTesting(id);
    setErr(null);
    const res = await testServerAction(id);
    setTesting(null);
    if (res.ok && res.data) {
      const online = res.data.online;
      setServers((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: online ? 'ONLINE' : 'OFFLINE' } as ServerDto : s)),
      );
      setMsg(online ? 'Kết nối thành công!' : 'Không thể kết nối server');
    } else if (!res.ok) {
      setErr(res.error);
    }
  }

  return (
    <div className="space-y-4">
      {/* Server list */}
      <ul className="divide-y divide-white/5">
        {servers.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{s.name}</span>
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/50">
                  {s.type}
                </span>
              </div>
              {s.type === 'REMOTE' && (
                <p className="mt-0.5 truncate text-xs text-white/40">
                  {s.username}@{s.host}:{s.port}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs ${STATUS_COLOR[s.status]}`}>
                {STATUS_LABEL[s.status]}
              </span>
              {s.type === 'REMOTE' && canManage && (
                <Button
                  variant="ghost"
                  onClick={() => testConn(s.id)}
                  disabled={testing === s.id}
                  className="h-7 px-2 text-xs text-white/60 hover:text-white"
                >
                  {testing === s.id ? 'Đang test…' : 'Test'}
                </Button>
              )}
              {canManage && s.type !== 'LOCAL' && (
                <Button
                  variant="ghost"
                  onClick={() => remove(s.id, s.type)}
                  className="h-7 px-2 text-xs text-red-400 hover:text-red-300"
                >
                  Xóa
                </Button>
              )}
            </div>
          </li>
        ))}
        {servers.length === 0 && (
          <li className="py-6 text-center text-sm text-white/30">Chưa có server nào</li>
        )}
      </ul>

      {/* Add form */}
      {canManage && (
        <div className="border-t border-white/10 pt-4">
          {!showForm ? (
            <Button variant="ghost" onClick={() => setShowForm(true)} className="text-sm">
              + Thêm server
            </Button>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-medium text-white/60">Thêm server mới</p>

              <div>
                <Label>Loại</Label>
                <div className="mt-1 flex gap-3">
                  {(['LOCAL', 'REMOTE'] as ServerType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setType(t)}
                      className={`rounded-full border px-3 py-1 text-xs transition ${
                        type === t
                          ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                          : 'border-white/10 text-white/50 hover:border-white/30'
                      }`}
                    >
                      {t === 'LOCAL' ? 'Local (máy này)' : 'Remote (VPS/SSH)'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label htmlFor="svr-name">Tên</Label>
                <Input
                  id="svr-name"
                  placeholder={type === 'LOCAL' ? 'Local Machine' : 'Production VPS'}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              {type === 'REMOTE' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="svr-host">Host / IP</Label>
                      <Input
                        id="svr-host"
                        placeholder="192.168.1.10"
                        value={host}
                        onChange={(e) => setHost(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="svr-port">SSH Port</Label>
                      <Input
                        id="svr-port"
                        type="number"
                        value={port}
                        onChange={(e) => setPort(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="svr-user">Username</Label>
                    <Input
                      id="svr-user"
                      placeholder="root"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="svr-key">SSH Private Key</Label>
                    <textarea
                      id="svr-key"
                      rows={5}
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                      value={sshKey}
                      onChange={(e) => setSshKey(e.target.value)}
                      className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <p className="mt-1 text-xs text-white/30">
                      Key sẽ được mã hóa AES-256 trước khi lưu.
                    </p>
                  </div>
                </>
              )}

              {err && <p className="text-xs text-red-400">{err}</p>}
              {msg && <p className="text-xs text-emerald-400">{msg}</p>}

              <div className="flex gap-2">
                <Button onClick={add} disabled={saving || !name.trim()}>
                  {saving ? 'Đang lưu…' : 'Lưu'}
                </Button>
                <Button variant="ghost" onClick={() => { setShowForm(false); setErr(null); }}>
                  Hủy
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {!canManage && (
        <p className="text-xs text-white/30">Chỉ Admin/Owner mới có thể thêm hoặc xóa server.</p>
      )}
    </div>
  );
}
