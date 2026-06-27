import type { Operator, OperatorPermission, OperatorRole } from '@/types/operator';

/**
 * 운영자 관리 순수 헬퍼 (page_admin_operator_permissions.md 2·4장).
 * 컴포넌트/훅에서 분리해 단위 테스트 대상으로 둔다.
 */

/** 권한 등급 강도(높을수록 강함). 정렬/비교용. */
export const PERMISSION_RANK: Record<OperatorPermission, number> = {
  OWNER: 4,
  MANAGER: 3,
  STAFF: 2,
  VIEWER: 1,
};

/** 최고관리자 권한은 ADMIN 역할에만 부여 가능. */
export function isSuperAdminAssignable(role: OperatorRole): boolean {
  return role === 'ADMIN';
}

/**
 * 폼 유효성: 최고관리자 체크 시 역할은 반드시 ADMIN.
 * (서버 admin_create_operator/admin_update_operator 와 동일 규칙의 클라이언트 사전검증)
 */
export function superAdminRoleConflict(role: OperatorRole, isSuper: boolean): boolean {
  return isSuper && role !== 'ADMIN';
}

/**
 * 비활성화 가능 여부. 본인 계정은 비활성화할 수 없다(자기 잠금 방지).
 * 이미 비활성 상태면 비활성화 대상이 아니다.
 */
export function canDeactivate(op: Operator, currentUserId: string): boolean {
  return op.active && op.id !== currentUserId;
}

/** 활성 상태 한국어 라벨. */
export function operatorStatusLabel(active: boolean): string {
  return active ? '활성' : '비활성';
}

/** 목록 요약 통계(상단 카드용). */
export function summarizeOperators(list: Operator[]): {
  total: number;
  active: number;
  superAdmins: number;
  staff: number;
} {
  return {
    total: list.length,
    active: list.filter((o) => o.active).length,
    superAdmins: list.filter((o) => o.is_super_admin && o.active).length,
    staff: list.filter((o) => o.role === 'STAFF').length,
  };
}
