import { NavLink } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { ROLE_NAV } from '@/lib/navigation';
import { ROLE_LABELS } from '@/lib/labels';

/**
 * 토글형 네비게이션 사이드바 (page_auth_layout.md §2.2 / §2.4).
 * - 데스크톱(lg+): 좌측 240px 고정.
 * - 모바일/태블릿: 햄버거로 좌측 슬라이드인 + 반투명 백드롭.
 */
export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const { sidebarOpen, closeSidebar } = useUiStore();
  if (!user) return null;

  const items = ROLE_NAV[user.role];

  return (
    <>
      {/* 모바일 백드롭 */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="메뉴 닫기"
          onClick={closeSidebar}
          className="fixed inset-0 z-30 bg-neutral-base/50 lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-60 transform bg-neutral-base text-white transition-transform duration-200 lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-14 items-center border-b border-white/15 px-4">
          <span className="rounded-md bg-brand px-2 py-0.5 text-sm font-bold text-white">YNA</span>
          <span className="ml-2 text-sm font-semibold">{ROLE_LABELS[user.role]}</span>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={closeSidebar}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                  isActive ? 'bg-brand text-white' : 'text-white/90 hover:bg-white/10'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}
