import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { useAuthStore } from '@/stores/authStore';
import type { EventOperatorRole, Operator } from '@/types/operator';

/**
 * 운영자 목록 (admin_list_operators RPC — 최고관리자 전용, 비활성 포함).
 * 배정 행사 수·최근 로그인까지 한 번에 반환한다.
 */
export function useOperators() {
  const user = useAuthStore((s) => s.user);
  const enabled = user?.role === 'ADMIN' && user.is_super_admin === true;
  return useQuery<Operator[]>({
    queryKey: ['operators'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_list_operators');
      if (error) throw new Error(error.message);
      return (data ?? []) as Operator[];
    },
  });
}

interface EventOperatorRoleEmbed {
  id: string;
  event_id: string;
  permission: EventOperatorRole['permission'];
  created_at: string;
  events: { title: string } | null;
}

/** 특정 운영자의 활성 행사 권한 목록(최고관리자 RLS 로 전체 조회). */
export function useEventOperatorRoles(userId: string | null) {
  return useQuery<EventOperatorRole[]>({
    queryKey: ['event-operators', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_operator_roles')
        .select('id,event_id,permission,created_at,events(title)')
        .eq('user_id', userId as string)
        .is('revoked_at', null)
        .returns<EventOperatorRoleEmbed[]>();
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        id: r.id,
        event_id: r.event_id,
        permission: r.permission,
        created_at: r.created_at,
        event_title: r.events?.title ?? '(삭제된 행사)',
      }));
    },
  });
}
