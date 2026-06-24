import { redirect } from 'next/navigation';

export default function Home() {
  // middleware sẽ chặn về /login nếu chưa đăng nhập
  redirect('/dashboard');
}
