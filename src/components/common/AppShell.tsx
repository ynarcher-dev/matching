import { Outlet } from 'react-router-dom';
import { Header } from '@/components/common/Header';
import { Sidebar } from '@/components/common/Sidebar';

/**
 * 인증 후 공통 웹 셸 (page_auth_layout.md §2).
 * 데스크톱: 좌측 고정 사이드바 + 우측 콘텐츠. 모바일: 햄버거 드로어.
 * 모바일 퍼스트(360~768px) 기준, lg 이상에서 사이드바 상시 노출.
 */
export function AppShell() {
  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
