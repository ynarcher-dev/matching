import type { OperatorPermission } from '@/types/operator';
import type { AppUser } from '@/types/auth';
import { PERMISSION_RANK } from '@/lib/operator';

/**
 * 행사별 운영자 권한 → 능력 매핑 (page_admin_operator_permissions.md §2.2·§5.2).
 * DB 헬퍼(can_manage_event/can_staff_event/can_view_event, 0039)의 프론트 대응이며,
 * 최종 권위는 서버 RLS/RPC(0042·0043)다. 여기서는 메뉴/버튼/탭 노출만 결정한다.
 *
 * 등급 포함관계 주의: manage=OWNER/MANAGER, staff=OWNER/MANAGER/STAFF, view=전체 등급.
 * (staff 가 manage 보다 넓다 — STAFF 는 현장만, MANAGER 는 관리까지.)
 */

/** 탭/기능이 요구하는 능력 수준. */
export type EventCapability = 'manage' | 'staff' | 'view';

/**
 * 현재 사용자의 행사 유효 권한. 최고관리자(super_admin)는 전 행사 OWNER 상당,
 * 그 외에는 배정된 권한(없으면 null = 접근 불가).
 */
export function effectiveEventPermission(
  user: Pick<AppUser, 'role' | 'is_super_admin'> | null | undefined,
  assigned: OperatorPermission | null | undefined,
): OperatorPermission | null {
  if (!user) return null;
  if (user.role === 'ADMIN' && user.is_super_admin) return 'OWNER';
  return assigned ?? null;
}

/** OWNER/MANAGER — 설정·참가자 배정·테이블·슬롯·AI 배치·강제 조정·알림 설정·다운로드. */
export function canManageEvent(permission: OperatorPermission | null): boolean {
  return permission === 'OWNER' || permission === 'MANAGER';
}

/** OWNER/MANAGER/STAFF — 현장 기능(출석·사진). */
export function canStaffEvent(permission: OperatorPermission | null): boolean {
  return permission != null && PERMISSION_RANK[permission] >= PERMISSION_RANK.STAFF;
}

/** 모든 활성 권한(VIEWER 이상) — 조회·리포트 확인. */
export function canViewEvent(permission: OperatorPermission | null): boolean {
  return permission != null;
}

/** 능력 수준 단일 판정(탭 필터 등에서 사용). */
export function hasCapability(
  permission: OperatorPermission | null,
  capability: EventCapability,
): boolean {
  switch (capability) {
    case 'manage':
      return canManageEvent(permission);
    case 'staff':
      return canStaffEvent(permission);
    case 'view':
      return canViewEvent(permission);
  }
}
