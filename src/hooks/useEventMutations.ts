import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { localInputToIso } from '@/lib/datetime';
import { eventKeys } from '@/hooks/useEvents';
import type { EventFormValues } from '@/schemas/eventSchemas';
import type { EventRow } from '@/types/event';

/** 폼 값(벽시계 문자열) → events 테이블 컬럼(UTC ISO) 변환. */
function toEventColumns(values: EventFormValues) {
  const { timezone } = values;
  return {
    title: values.title.trim(),
    max_sessions_per_startup: values.max_sessions_per_startup,
    timezone,
    allow_startup_self_booking: values.allow_startup_self_booking,
    booking_start: localInputToIso(values.booking_start, timezone),
    booking_end: localInputToIso(values.booking_end, timezone),
    event_start: localInputToIso(values.event_start, timezone),
    event_end: localInputToIso(values.event_end, timezone),
  };
}

/**
 * 행사 개설 (page_admin_event_list.md §2.2).
 * status 는 DB 기본값 DRAFT. ADMIN INSERT 는 events_insert_admin RLS 로 허용된다.
 */
export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: EventFormValues) => {
      const { data, error } = await supabase
        .from('events')
        .insert(toEventColumns(values))
        .select('id')
        .single<Pick<EventRow, 'id'>>();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: eventKeys.all }),
  });
}

/** 행사 편집(일정·정원·토글 수정). 상태/취소는 별도 RPC 경로. */
export function useUpdateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: EventFormValues }) => {
      const { error } = await supabase
        .from('events')
        .update(toEventColumns(values))
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: eventKeys.all }),
  });
}

/**
 * 행사 취소 — 물리 삭제가 아닌 CANCELLED 상태 전이.
 * 상태 직접 변경은 최고 관리자 전용이며 사유·감사 로그가 필수이므로
 * override_event_status RPC 를 경유한다(page_admin_event_list.md §2.2).
 */
export function useCancelEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc('override_event_status', {
        p_event_id: id,
        p_status: 'CANCELLED',
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: eventKeys.all }),
  });
}
