/**
 * 운영자 계정 / 행사별 권한 도메인 타입 (page_admin_operator_permissions.md 2장).
 */

/** 운영자 로그인 역할(참가자와 구분). */
export type OperatorRole = 'ADMIN' | 'STAFF';

/** 행사별 권한 등급. */
export type OperatorPermission = 'OWNER' | 'MANAGER' | 'STAFF' | 'VIEWER';

/** admin_list_operators RPC 한 행. */
export interface Operator {
  id: string;
  email: string;
  name: string;
  role: OperatorRole;
  is_super_admin: boolean;
  /** deleted_at IS NULL = 활성. */
  active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  assigned_event_count: number;
}

/** 운영자 생성/비밀번호 재설정 Edge 응답(임시 비밀번호 또는 초대 링크 1회 노출). */
export interface OperatorSecretResult {
  ok: boolean;
  id?: string;
  temp_password?: string;
  invite_link?: string;
}

/** 특정 운영자의 활성 행사 권한 1건(권한 배정 모달). */
export interface EventOperatorRole {
  id: string;
  event_id: string;
  permission: OperatorPermission;
  created_at: string;
  event_title: string;
}
