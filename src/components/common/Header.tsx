import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { displayName } from '@/lib/labels';

/**
 * 상단 헤더 (page_auth_layout.md §2.3).
 * - 왼쪽: 햄버거(모바일), 로고.
 * - 오른쪽: 사용자 호칭, 로그아웃.
 * (행사 진행 중 카운트다운 배지는 Phase 6 전문가 대시보드에서 연결)
 */
export function Header() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const navigate = useNavigate();

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-white px-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="메뉴 열기"
          onClick={toggleSidebar}
          className="rounded-md p-1.5 text-neutral-base transition-colors hover:bg-surface lg:hidden"
        >
          <HamburgerIcon />
        </button>
        <span className="rounded-md bg-brand px-2 py-0.5 text-sm font-bold text-white">YNA 매칭</span>
      </div>

      <div className="flex items-center gap-3">
        {user && (
          <span className="hidden max-w-[12rem] truncate text-sm font-semibold text-neutral-base sm:inline">
            {displayName(user)}
          </span>
        )}
        <button
          type="button"
          onClick={onLogout}
          className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-neutral-base transition-colors hover:bg-surface"
        >
          로그아웃
        </button>
      </div>
    </header>
  );
}

function HamburgerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
