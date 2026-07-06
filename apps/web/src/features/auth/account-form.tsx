'use client';

import { useState, type FormEvent } from 'react';
import type { UserDto } from '@deploybox/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
// Cookie db_token là httpOnly — JS trình duyệt KHÔNG đọc được, nên phải gọi
// qua server action (chạy server-side, đọc cookie hộ). Đừng fetch API trực tiếp ở đây.
import { changePasswordAction, set2faAction, updateNameAction } from './account-actions';

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

  const [tfa, setTfa] = useState(user.twoFactorEnabled ?? false);
  const [savingTfa, setSavingTfa] = useState(false);
  const [tfaMsg, setTfaMsg] = useState<string | null>(null);
  const [tfaErr, setTfaErr] = useState<string | null>(null);

  async function onToggle2fa() {
    const next = !tfa;
    setSavingTfa(true);
    setTfaMsg(null);
    setTfaErr(null);
    const res = await set2faAction(next);
    if (res.ok) {
      setTfa(next);
      setTfaMsg(next ? 'Đã bật 2FA — lần đăng nhập sau sẽ cần mã OTP email' : 'Đã tắt 2FA');
    } else setTfaErr(res.error);
    setSavingTfa(false);
  }

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

      <div className="border-t border-white/10 pt-4">
        <h3 className="mb-1 text-sm font-medium text-white/70">Xác thực 2 lớp (2FA)</h3>
        <p className="mb-3 text-xs text-white/40">
          Bật: sau khi nhập đúng mật khẩu, phải nhập thêm mã OTP gửi về email — ai lấy được mật
          khẩu cũng không vào được tài khoản.
        </p>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-white/70">
            <input
              type="checkbox"
              checked={tfa}
              disabled={savingTfa}
              onChange={onToggle2fa}
            />
            {tfa ? 'Đang bật' : 'Đang tắt'}
          </label>
          {savingTfa && <span className="text-xs text-white/40">Đang lưu…</span>}
          {tfaMsg && <span className="text-sm text-emerald-400">{tfaMsg}</span>}
          {tfaErr && <span className="text-sm text-red-400">{tfaErr}</span>}
        </div>
      </div>
    </div>
  );
}
