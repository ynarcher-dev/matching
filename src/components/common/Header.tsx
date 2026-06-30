import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { displayName, ROLE_LABELS } from '@/lib/labels';

/**
 * 상단 헤더 (page_auth_layout.md §2.3 / 9-C).
 * - 왼쪽: 햄버거(모바일), 로고.
 * - 오른쪽: 역할 배지 + 사용자 호칭(위계), 로그아웃.
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

  const isSuper = user?.role === 'ADMIN' && user.is_super_admin;

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-surface-raised px-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="메뉴 열기"
          onClick={toggleSidebar}
          className="rounded-md p-1.5 text-neutral-base transition-colors hover:bg-surface lg:hidden"
        >
          <HamburgerIcon />
        </button>
        <span className="text-base font-bold text-neutral-base">비즈니스 매칭</span>
      </div>

      <div className="flex items-center gap-3">
        {user && (
          <div className="hidden items-center gap-2 sm:flex">
            <Badge tone={isSuper ? 'brand' : 'neutral'} size="11">
              {isSuper ? '최고관리자' : ROLE_LABELS[user.role]}
            </Badge>
            <span className="max-w-[12rem] truncate text-sm font-semibold text-neutral-base">
              {displayName(user)}
            </span>
          </div>
        )}
        <Button variant="outline" size="sm" onClick={onLogout}>
          로그아웃
        </Button>
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
