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

/** 한 행사에 배정된 운영자 1건(행사 기준 배정 모달, 8-D). */
export interface EventOperatorAssignment {
  id: string;
  user_id: string;
  permission: EventOperatorRole['permission'];
  created_at: string;
  operator_name: string;
  operator_email: string;
}

interface EventOperatorAssignmentEmbed {
  id: string;
  user_id: string;
  permission: EventOperatorRole['permission'];
  created_at: string;
  users: { name: string; email: string | null } | null;
}

/**
 * 특정 행사에 배정된 활성 운영자 목록 (8-D, 행사 상세 운영자 배정 모달).
 * 최고관리자 RLS 로 전체 조회. useEventOperatorRoles 의 행사 기준 역방향.
 */
export function useEventOperators(eventId: string | null) {
  return useQuery<EventOperatorAssignment[]>({
    queryKey: ['event-operators-by-event', eventId],
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_operator_roles')
        .select('id,user_id,permission,created_at,users(name,email)')
        .eq('event_id', eventId as string)
        .is('revoked_at', null)
        .returns<EventOperatorAssignmentEmbed[]>();
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        id: r.id,
        user_id: r.user_id,
        permission: r.permission,
        created_at: r.created_at,
        operator_name: r.users?.name ?? '(삭제된 계정)',
        operator_email: r.users?.email ?? '',
      }));
    },
  });
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
