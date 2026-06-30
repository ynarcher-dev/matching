import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { useAuthStore } from '@/stores/authStore';
import type { OperatorPermission } from '@/types/operator';

interface MyEventRoleRow {
  event_id: string;
  permission: OperatorPermission;
}

/** useMyEventRoles 반환 — 행사별 내 권한 조회기. */
export interface MyEventRoles {
  /** 최고관리자 여부(전 행사 OWNER 상당). */
  isSuper: boolean;
  /** 비-super 운영자의 배정 권한 로딩 중인지. */
  isLoading: boolean;
  /** 행사 유효 권한(super=OWNER, 배정=등급, 미배정=null). */
  permissionFor: (eventId: string) => OperatorPermission | null;
}

/**
 * 현재 사용자의 행사별 운영자 권한 (page_admin_operator_permissions.md §5.2).
 * - 최고관리자: 조회 불필요 — 전 행사 OWNER 로 취급(쿼리 비활성화).
 * - 일반 운영자: `event_operator_roles` 본인 활성 행만 조회(RLS event_operator_select).
 * 메뉴/배지/탭 노출 판단용이며 최종 권위는 서버 RLS/RPC(0042·0043).
 */
export function useMyEventRoles(): MyEventRoles {
  const user = useAuthStore((s) => s.user);
  const isSuper = user?.role === 'ADMIN' && user.is_super_admin === true;

  const query = useQuery<Map<string, OperatorPermission>>({
    queryKey: ['my-event-roles', user?.id],
    enabled: Boolean(user) && !isSuper,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_operator_roles')
        .select('event_id,permission')
        .eq('user_id', user!.id)
        .is('revoked_at', null)
        .returns<MyEventRoleRow[]>();
      if (error) throw new Error(error.message);
      const map = new Map<string, OperatorPermission>();
      for (const row of data ?? []) map.set(row.event_id, row.permission);
      return map;
    },
  });

  return {
    isSuper,
    isLoading: query.isLoading,
    permissionFor: (eventId: string) =>
      isSuper ? 'OWNER' : (query.data?.get(eventId) ?? null),
  };
}
