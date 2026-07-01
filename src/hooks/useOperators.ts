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

/** list_event_operators RPC 반환 행(SECURITY DEFINER, can_manage_event 게이트). */
interface EventOperatorRpcRow {
  id: string;
  user_id: string;
  permission: EventOperatorRole['permission'];
  created_at: string;
  operator_name: string | null;
  operator_email: string | null;
}

/**
 * 특정 행사에 배정된 활성 운영자 목록 (8-D, 행사 상세 운영자 배정 모달 + 테이블 담당자 풀).
 * event_operator_roles SELECT RLS 는 "본인 행"만 노출하므로 직접 조회로는 MANAGER 가
 * 목록을 못 본다(0064 NOTE). RLS 를 넓히지 않고, 관리권한자(can_manage_event = 최고관리자
 * 또는 OWNER/MANAGER)에게만 해당 행사 운영자 전체를 돌려주는 list_event_operators RPC 로
 * 조회한다(보안계획 A-11). 권한 밖 행사는 빈 결과, 최고관리자는 기존과 동일 결과.
 */
export function useEventOperators(eventId: string | null) {
  return useQuery<EventOperatorAssignment[]>({
    queryKey: ['event-operators-by-event', eventId],
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_event_operators', {
        p_event_id: eventId as string,
      });
      if (error) throw new Error(error.message);
      return ((data ?? []) as EventOperatorRpcRow[]).map((r) => ({
        id: r.id,
        user_id: r.user_id,
        permission: r.permission,
        created_at: r.created_at,
        operator_name: r.operator_name ?? '(삭제된 계정)',
        operator_email: r.operator_email ?? '',
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
