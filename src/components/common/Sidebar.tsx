import { NavLink } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { navItemsFor } from '@/lib/navigation';
import { ROLE_LABELS } from '@/lib/labels';

/**
 * 토글형 네비게이션 사이드바 (page_auth_layout.md §2.2 / §2.4 / 9-C).
 * - 데스크톱(lg+): 좌측 고정. 펼침 240px / 접힘 64px(아이콘+tooltip).
 * - 모바일/태블릿: 햄버거로 좌측 슬라이드인(항상 펼친 폭) + 반투명 백드롭.
 */
export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const closeSidebar = useUiStore((s) => s.closeSidebar);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleCollapsed = useUiStore((s) => s.toggleSidebarCollapsed);
  if (!user) return null;

  const items = navItemsFor(user);

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
        className={`fixed inset-y-0 left-0 z-40 w-60 transform bg-neutral-base text-white transition-all duration-200 lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'lg:w-16' : 'lg:w-60'}`}
      >
        <div
          className={`flex h-14 items-center border-b border-white/15 ${
            collapsed ? 'lg:justify-center lg:px-0' : 'justify-between px-3'
          } px-3`}
        >
          {/* 접힘 시에는 로고/역할을 숨기고 토글만 노출(64px 레일). */}
          <div className={`flex min-w-0 items-center ${collapsed ? 'lg:hidden' : ''}`}>
            <span className="rounded-md bg-brand px-2 py-0.5 text-sm font-bold text-white">YNA</span>
            <span className="ml-2 truncate text-sm font-semibold">{ROLE_LABELS[user.role]}</span>
          </div>
          {/* 데스크톱 접기/펼치기 토글(모바일에는 없음) */}
          <button
            type="button"
            aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
            title={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
            onClick={toggleCollapsed}
            className="hidden shrink-0 rounded-md p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white lg:inline-flex"
          >
            {collapsed ? '»' : '«'}
          </button>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={closeSidebar}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                  collapsed ? 'lg:justify-center lg:px-0' : ''
                } ${isActive ? 'bg-brand text-white' : 'text-white/90 hover:bg-white/10'}`
              }
            >
              <span aria-hidden className="text-base leading-none">
                {item.icon}
              </span>
              <span className={collapsed ? 'lg:hidden' : ''}>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}
