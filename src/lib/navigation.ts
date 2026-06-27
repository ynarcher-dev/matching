import type { AppRole, AppUser } from '@/types/auth';

/**
 * 역할별 네비게이션·홈 경로 (page_auth_layout.md §1.3, §2.4).
 * 사이드바 메뉴와 로그인 후 리다이렉션이 모두 이 단일 소스를 참조한다.
 */
export interface NavItem {
  label: string;
  path: string;
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
    { label: '행사 목록', path: '/admin/events' },
    { label: '참가자 DB 관리', path: '/admin/users' },
    { label: '설정', path: '/admin/settings' },
  ],
  STAFF: [
    { label: '출석 체크', path: '/staff/check-in' },
    { label: '현장 사진', path: '/staff/photos' },
  ],
  EXPERT: [
    { label: '오늘의 스케줄', path: '/expert/dashboard' },
    { label: '이전 상담 이력', path: '/expert/history' },
  ],
  STARTUP: [
    { label: '내 예약 관리', path: '/startup/booking' },
    { label: '안내 사항', path: '/startup/notices' },
  ],
};

export function homePathFor(role: AppRole): string {
  return ROLE_HOME_PATH[role];
}

/**
 * 사용자별 사이드바 메뉴. 기본은 역할 메뉴이며, 최고관리자는 운영자 관리 메뉴가 추가된다.
 */
export function navItemsFor(user: AppUser): NavItem[] {
  const base = ROLE_NAV[user.role];
  if (user.role === 'ADMIN' && user.is_super_admin) {
    return [...base, { label: '운영자 관리', path: '/admin/operators' }];
  }
  return base;
}
