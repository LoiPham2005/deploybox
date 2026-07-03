'use client';

import { useState, type FormEvent } from 'react';
import type { UserDto } from '@deploybox/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
// Cookie db_token là httpOnly — JS trình duyệt KHÔNG đọc được, nên phải gọi
// qua server action (chạy server-side, đọc cookie hộ). Đừng fetch API trực tiếp ở đây.
import { changePasswordAction, updateNameAction } from './account-actions';

export function AccountForm({ user }: { user: UserDto }) {
  const [name, setName] = useState(user.name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [nameErr, setNameErr] = useState<string | null>(null);

  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);

  async function onUpdateName(e: FormEvent) {
    e.preventDefault();
    setSavingName(true);
    setNameMsg(null);
    setNameErr(null);
    const res = await updateNameAction(name);
    if (res.ok) setNameMsg('Đã lưu');
    else setNameErr(res.error);
    setSavingName(false);
  }

  async function onChangePassword(e: FormEvent) {
    e.preventDefault();
    if (newPw.length < 8) { setPwErr('Mật khẩu mới tối thiểu 8 ký tự'); return; }
    setSavingPw(true);
    setPwMsg(null);
    setPwErr(null);
    const res = await changePasswordAction(curPw, newPw);
    if (res.ok) {
      setPwMsg('Đã đổi mật khẩu');
      setCurPw('');
      setNewPw('');
    } else {
      setPwErr(res.error);
    }
    setSavingPw(false);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onUpdateName} className="space-y-3">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={user.email} disabled className="opacity-50" />
        </div>
        <div>
          <Label htmlFor="name">Tên hiển thị</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={savingName}>{savingName ? 'Đang lưu…' : 'Lưu'}</Button>
          {nameMsg && <span className="text-sm text-emerald-400">{nameMsg}</span>}
          {nameErr && <span className="text-sm text-red-400">{nameErr}</span>}
        </div>
      </form>

      <div className="border-t border-white/10 pt-4">
        <h3 className="mb-3 text-sm font-medium text-white/70">Đổi mật khẩu</h3>
        <form onSubmit={onChangePassword} className="space-y-3">
          <div>
            <Label htmlFor="curPw">Mật khẩu hiện tại</Label>
            <Input
              id="curPw"
              type="password"
              value={curPw}
              onChange={(e) => setCurPw(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div>
            <Label htmlFor="newPw">Mật khẩu mới</Label>
            <Input
              id="newPw"
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={savingPw || !curPw || !newPw}>
              {savingPw ? 'Đang đổi…' : 'Đổi mật khẩu'}
            </Button>
            {pwMsg && <span className="text-sm text-emerald-400">{pwMsg}</span>}
            {pwErr && <span className="text-sm text-red-400">{pwErr}</span>}
          </div>
        </form>
      </div>
    </div>
  );
}
