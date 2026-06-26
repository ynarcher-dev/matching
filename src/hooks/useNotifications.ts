import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { sortByAttention } from '@/lib/notification';
import type { NotificationLog } from '@/types/notification';

/**
 * 알림 발송 로그 조회 + 관리자 수동 재시도 (Phase 7 슬라이스 1).
 * 출처: docs/db_schema.md 2.15, docs/security_transactions.md 4장.
 * RLS(0003): notif_select_admin — ADMIN 만 SELECT. 발송/상태전이는 service_role(Edge).
 * 재시도는 retry_notification RPC(ADMIN 가드, FAILED → PENDING 초기화).
 * operator supabase 클라이언트 사용.
 */

const NOTIFICATION_POLL_MS = 15_000;

export const notificationKeys = {
  byEvent: (eventId: string) => ['notifications', eventId] as const,
};

/** 이 행사의 알림 로그(주목 항목 우선 정렬). 진행 중 발송 반영을 위해 15초 폴링. */
export function useEventNotifications(eventId: string) {
  return useQuery<NotificationLog[]>({
    queryKey: notificationKeys.byEvent(eventId),
    enabled: Boolean(eventId),
    refetchInterval: NOTIFICATION_POLL_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_logs')
        .select(
          'id,event_id,receiver_id,notification_type,channel,destination,content,status,retry_count,next_retry_at,error_message,created_at,updated_at',
        )
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return sortByAttention((data as NotificationLog[] | null) ?? []);
    },
  });
}

/** FAILED 알림을 PENDING 으로 초기화(다음 디스패치에서 재발송). */
export function useRetryNotification(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('retry_notification', { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.byEvent(eventId) });
    },
  });
}
