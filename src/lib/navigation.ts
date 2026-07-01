import type { AppRole, AppUser } from '@/types/auth';

/**
 * 역할별 네비게이션·홈 경로 (page_auth_layout.md §1.3, §2.4).
 * 사이드바 메뉴와 로그인 후 리다이렉션이 모두 이 단일 소스를 참조한다.
 */
export interface NavItem {
  label: string;
  path: string;
  /** 접힌 사이드바(9-C)에서 표시할 아이콘 글리프. */
  icon: string;
}

/** 로그인 직후 역할별 진입 경로. */
export const ROLE_HOME_PATH: Record<AppRole, string> = {
  ADMIN: '/admin/events',
  STAFF: '/staff/check-in',
  EXPERT: '/expert/dashboard',
  STARTUP: '/startup/booking',
};

/** 사이드바 메뉴(역할별 가변). */
export const ROLE_NAV: Record<AppRole, NavItem[]> = {
  ADMIN: [
    { label: '행사 목록', path: '/admin/events', icon: '📅' },
    { label: '스타트업 DB', path: '/admin/startups', icon: '🚀' },
    { label: '전문가 DB', path: '/admin/experts', icon: '👤' },
    { label: '안내발송 관리', path: '/admin/settings', icon: '🔔' },
  ],
  STAFF: [
    { label: '출석 체크', path: '/staff/check-in', icon: '✅' },
    { label: '현장 사진', path: '/staff/photos', icon: '📷' },
  ],
  EXPERT: [
    { label: '오늘의 스케줄', path: '/expert/dashboard', icon: '🗓' },
    { label: '안내 사항', path: '/expert/notices', icon: '📢' },
  ],
  STARTUP: [
    { label: '예약 및 조회', path: '/startup/booking', icon: '🗓' },
    { label: '자료 첨부', path: '/startup/proposals', icon: '📎' },
    { label: '안내 사항', path: '/startup/notices', icon: '📢' },
  ],
};

export function homePathFor(role: AppRole): string {
  return ROLE_HOME_PATH[role];
}

const ALL_NAV_ITEMS: NavItem[] = Object.values(ROLE_NAV).flat();

/**
 * 사용자별 사이드바 메뉴 (page_admin_operator_permissions.md §5.1).
 * 일반 ADMIN/STAFF 는 역할 메뉴를 쓰되, 전역 화면(스타트업/전문가 DB·안내발송 관리·운영자 관리)은
 * 최고관리자에게만 노출한다. 일반 관리자는 배정 행사만 다루므로 `행사 목록`만 본다.
 */
export function navItemsFor(user: AppUser): NavItem[] {
  if (user.role === 'ADMIN') {
    const items: NavItem[] = [{ label: '행사 목록', path: '/admin/events', icon: '📅' }];
    if (user.is_super_admin) {
      items.push(
        { label: '스타트업 DB', path: '/admin/startups', icon: '🚀' },
        { label: '전문가 DB', path: '/admin/experts', icon: '👤' },
        { label: '안내발송 관리', path: '/admin/settings', icon: '🔔' },
        { label: '운영자 관리', path: '/admin/operators', icon: '🔐' },
      );
    }
    return items;
  }
  return ROLE_NAV[user.role];
}

/** 현재 경로에 해당하는 상단 헤더 제목. */
export function getNavTitle(pathname: string): string {
  const item = ALL_NAV_ITEMS.find((n) => pathname === n.path || pathname.startsWith(`${n.path}/`));
  if (item?.label === '행사 목록') return '비즈니스 매칭';
  return item?.label ?? '비즈니스 매칭';
}
