import { NavLink } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { navItemsFor } from '@/lib/navigation';
import { Logo } from '@/components/common/Logo';

/**
 * 토글형 네비게이션 사이드바 (page_auth_layout.md §2.2 / §2.4 / 9-C).
 * - 데스크톱(lg+): 좌측 고정. 펼침 240px / 접힘 80px(아이콘+tooltip).
 * - 모바일/태블릿: 햄버거로 좌측 슬라이드인(항상 펼친 폭) + 반투명 백드롭.
 */
export function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const closeSidebar = useUiStore((s) => s.closeSidebar);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
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
        className={`fixed inset-y-0 left-0 z-40 w-60 transform bg-[#515151] text-white shadow-xl transition-all duration-200 lg:static lg:translate-x-0 lg:shadow-none ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'lg:w-20' : 'lg:w-60'}`}
      >
        <div className="flex h-16 items-center justify-center border-b border-black/20 px-4">
          <div className="flex min-w-0 items-center justify-center">
            {collapsed ? (
              <span className="hidden text-base font-bold tracking-[1px] text-white lg:inline">YNA</span>
            ) : (
              <Logo className="h-7 w-36 brightness-0 invert" />
            )}
          </div>
        </div>
        <nav className="flex flex-col gap-1 px-2 py-3">
          {items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={closeSidebar}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `group relative flex h-10 items-center gap-3 rounded-md px-3 text-sm font-semibold transition-colors ${
                  collapsed ? 'lg:justify-center lg:px-0' : ''
                } ${
                  isActive
                    ? 'bg-white/10 text-white before:absolute before:left-0 before:top-2 before:h-6 before:w-1 before:rounded-r before:bg-brand'
                    : 'text-white/90 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <span
                aria-hidden
                className={`grid h-6 w-6 shrink-0 place-items-center rounded text-base leading-none ${
                  collapsed ? 'lg:bg-white/10' : ''
                }`}
              >
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
