import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import type { EventRow, EventWithCounts } from '@/types/event';

/** events 행 + 카드 통계에서 쓰는 컬럼(민감 컬럼 제외). */
const EVENT_COLUMNS =
  'id,title,status,status_override,status_override_reason,booking_start,booking_end,' +
  'event_start,event_end,max_sessions_per_startup,allow_startup_self_booking,' +
  'allow_duplicate_expert,satisfaction_policy,timezone,created_at';

export const eventKeys = {
  all: ['events'] as const,
  list: () => [...eventKeys.all, 'list'] as const,
  detail: (id: string) => [...eventKeys.all, 'detail', id] as const,
};

/**
 * 행사 목록 + 참가 통계 조회 (page_admin_event_list.md §1.2).
 * 관리자(operator)는 RLS 상 전체 행사를 조회한다. 상태/검색 필터는 화면에서 적용한다.
 * 통계는 event_participants 를 타입별로 묶어 카드의 `스타트업 N / 전문가 M` 을 만든다.
 */
export function useEvents() {
  return useQuery<EventWithCounts[]>({
    queryKey: eventKeys.list(),
    queryFn: async () => {
      const { data: events, error } = await supabase
        .from('events')
        .select(EVENT_COLUMNS)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .returns<EventRow[]>();
      if (error) throw error;
      if (!events || events.length === 0) return [];

      const ids = events.map((e) => e.id);
      const { data: parts, error: partsError } = await supabase
        .from('event_participants')
        .select('event_id,participant_type')
        .in('event_id', ids)
        .returns<{ event_id: string; participant_type: 'EXPERT' | 'STARTUP' }[]>();
      if (partsError) throw partsError;

      const counts = new Map<string, { expert: number; startup: number }>();
      for (const p of parts ?? []) {
        const c = counts.get(p.event_id) ?? { expert: 0, startup: 0 };
        if (p.participant_type === 'EXPERT') c.expert += 1;
        else c.startup += 1;
        counts.set(p.event_id, c);
      }

      return events.map((e, index) => ({
        ...e,
        no: events.length - index,
        expertCount: counts.get(e.id)?.expert ?? 0,
        startupCount: counts.get(e.id)?.startup ?? 0,
      }));
    },
  });
}
