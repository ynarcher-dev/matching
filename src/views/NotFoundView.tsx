import { Link } from 'react-router-dom';

export function NotFoundView() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface p-6 text-center">
      <h1 className="text-3xl font-bold text-neutral-base">404</h1>
      <p className="text-sm text-neutral-base">요청하신 페이지를 찾을 수 없습니다.</p>
      <Link to="/" className="bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover">
        처음으로
      </Link>
    </main>
  );
}
