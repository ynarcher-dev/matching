import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import type { EventRow } from '@/types/event';
import type {
  AssignableUser,
  EventParticipantRow,
  EventTable,
  MatchingSlotRow,
} from '@/types/eventDetail';

/** 상세 화면에서 쓰는 events 컬럼(목록과 동일 + 상태 고정 메타). */
const EVENT_DETAIL_COLUMNS =
  'id,title,status,status_override,status_override_reason,booking_start,booking_end,' +
  'event_start,event_end,max_sessions_per_startup,allow_startup_self_booking,' +
  'allow_duplicate_expert,timezone,created_at';

export const eventDetailKeys = {
  root: (eventId: string) => ['event-detail', eventId] as const,
  event: (eventId: string) => [...eventDetailKeys.root(eventId), 'event'] as const,
  participants: (eventId: string) => [...eventDetailKeys.root(eventId), 'participants'] as const,
  tables: (eventId: string) => [...eventDetailKeys.root(eventId), 'tables'] as const,
  slots: (eventId: string) => [...eventDetailKeys.root(eventId), 'slots'] as const,
  assignable: ['assignable-users'] as const,
};

/** 단일 행사 조회 (관리자 RLS 직접 SELECT). */
export function useEventDetail(eventId: string) {
  return useQuery<EventRow>({
    queryKey: eventDetailKeys.event(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select(EVENT_DETAIL_COLUMNS)
        .eq('id', eventId)
        .is('deleted_at', null)
        .single<EventRow>();
      if (error) throw error;
      return data;
    },
  });
}

/** 행사 참가자(event_participants) 행 목록. 이름은 useAssignableUsers 로 해석한다. */
export function useEventParticipants(eventId: string) {
  return useQuery<EventParticipantRow[]>({
    queryKey: eventDetailKeys.participants(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_participants')
        .select('id,event_id,user_id,participant_type,default_table_id')
        .eq('event_id', eventId)
        .returns<EventParticipantRow[]>();
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** 행사장 테이블 목록. */
export function useEventTables(eventId: string) {
  return useQuery<EventTable[]>({
    queryKey: eventDetailKeys.tables(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_tables')
        .select('id,event_id,table_code,description,is_active')
        .eq('event_id', eventId)
        .order('table_code', { ascending: true })
        .returns<EventTable[]>();
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * 행사 매칭 슬롯 목록(시간순). 강제 조정·예약 현황 통계·진행 타임그리드의 원천.
 * @param opts.refetchInterval 진행 단계 실시간 폴링용(ms). 미지정 시 폴링하지 않는다.
 */
export function useEventSlots(eventId: string, opts?: { refetchInterval?: number }) {
  return useQuery<MatchingSlotRow[]>({
    queryKey: eventDetailKeys.slots(eventId),
    refetchInterval: opts?.refetchInterval ?? false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matching_slots')
        .select(
          'id,event_id,expert_id,startup_id,start_time,end_time,table_id,booking_type,session_status',
        )
        .eq('event_id', eventId)
        .order('start_time', { ascending: true })
        .returns<MatchingSlotRow[]>();
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * 지정 후보 사용자(전문가/스타트업) 전체 조회. 참가자 picker 와 슬롯/참가자 이름 해석에 공용.
 * 참가자 규모가 크지 않다는 가정(목록과 동일)에서 화면 단 필터를 쓴다.
 */
export function useAssignableUsers() {
  return useQuery<AssignableUser[]>({
    queryKey: eventDetailKeys.assignable,
    staleTime: 1000 * 60,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select(
          'id,name,role,company_name,representative_name,expert_organization,expert_position',
        )
        .is('deleted_at', null)
        .in('role', ['EXPERT', 'STARTUP'])
        .order('name', { ascending: true })
        .returns<AssignableUser[]>();
      if (error) throw error;
      return data ?? [];
    },
  });
}
