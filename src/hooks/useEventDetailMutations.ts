import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { eventKeys } from '@/hooks/useEvents';
import { eventDetailKeys } from '@/hooks/useEventDetail';
import type { EventTableFormValues } from '@/schemas/eventDetailSchemas';
import type { ParticipantRole } from '@/types/user';

/**
 * 행사 상세 대시보드 쓰기 (page_admin_event_detail.md §2.1, §3.2).
 * 마스터 편집(참가자/테이블/자율예약 토글)은 ADMIN RLS 직접, 슬롯 강제 조정은 RPC 경유.
 */

/** 참가자/테이블 변경 시 상세 + 목록 카운트를 함께 무효화한다. */
function useDetailInvalidation(eventId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: eventDetailKeys.root(eventId) });
    qc.invalidateQueries({ queryKey: eventKeys.all });
  };
}

/** 행사에 참가자(전문가/스타트업) 일괄 추가 — event_participants INSERT(ADMIN RLS). */
export function useAddParticipants(eventId: string) {
  const invalidate = useDetailInvalidation(eventId);
  return useMutation({
    mutationFn: async ({
      userIds,
      type,
    }: {
      userIds: string[];
      type: ParticipantRole;
    }) => {
      if (userIds.length === 0) return 0;
      const rows = userIds.map((user_id) => ({
        event_id: eventId,
        user_id,
        participant_type: type,
      }));
      const { error } = await supabase.from('event_participants').insert(rows);
      if (error) throw mapParticipantError(error);
      return rows.length;
    },
    onSuccess: invalidate,
  });
}

/** 참가자 제외 — event_participants DELETE(슬롯은 FK SET NULL 로 보존). */
export function useRemoveParticipant(eventId: string) {
  const invalidate = useDetailInvalidation(eventId);
  return useMutation({
    mutationFn: async (participantId: string) => {
      const { error } = await supabase
        .from('event_participants')
        .delete()
        .eq('id', participantId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** 참가자 기본 테이블 지정/해제 — default_table_id UPDATE. */
export function useSetDefaultTable(eventId: string) {
  const invalidate = useDetailInvalidation(eventId);
  return useMutation({
    mutationFn: async ({
      participantId,
      tableId,
    }: {
      participantId: string;
      tableId: string | null;
    }) => {
      const { error } = await supabase
        .from('event_participants')
        .update({ default_table_id: tableId })
        .eq('id', participantId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** 행사장 테이블 등록/편집 — event_tables INSERT/UPDATE(ADMIN RLS). */
export function useSaveEventTable(eventId: string) {
  const invalidate = useDetailInvalidation(eventId);
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: EventTableFormValues }) => {
      const row = {
        table_code: values.table_code.trim(),
        description: values.description?.trim() ? values.description.trim() : null,
        is_active: values.is_active,
      };
      if (id) {
        const { error } = await supabase.from('event_tables').update(row).eq('id', id);
        if (error) throw mapTableError(error);
      } else {
        const { error } = await supabase
          .from('event_tables')
          .insert({ ...row, event_id: eventId });
        if (error) throw mapTableError(error);
      }
    },
    onSuccess: invalidate,
  });
}

/** 행사장 테이블 삭제 — event_tables DELETE(참조 슬롯/참가자는 FK SET NULL). */
export function useDeleteEventTable(eventId: string) {
  const invalidate = useDetailInvalidation(eventId);
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('event_tables').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** 스타트업 자율 예약 허용 토글 — events UPDATE(ADMIN RLS). */
export function useToggleSelfBooking(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase
        .from('events')
        .update({ allow_startup_self_booking: next })
        .eq('id', eventId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: eventDetailKeys.event(eventId) });
      qc.invalidateQueries({ queryKey: eventKeys.all });
    },
  });
}

/** 슬롯 자동 생성 — generate_event_slots RPC(전문가별 그리드, 빈 슬롯만 교체). 생성 수 반환. */
export function useGenerateSlots(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      startIso: string;
      sessionMinutes: number;
      breakMinutes: number;
      sessionCount: number;
      expertIds?: string[];
      replaceUnbooked: boolean;
    }) => {
      const { data, error } = await supabase.rpc('generate_event_slots', {
        p_event_id: eventId,
        p_start_time: params.startIso,
        p_session_minutes: params.sessionMinutes,
        p_session_count: params.sessionCount,
        p_break_minutes: params.breakMinutes,
        p_expert_ids: params.expertIds ?? null,
        p_replace_unbooked: params.replaceUnbooked,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: eventDetailKeys.slots(eventId) }),
  });
}

/** 빈 슬롯 초기화 — clear_unbooked_slots RPC(예약/진행 슬롯은 보존). 삭제 수 반환. */
export function useClearUnbookedSlots(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('clear_unbooked_slots', {
        p_event_id: eventId,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: eventDetailKeys.slots(eventId) }),
  });
}

/** 관리자 강제 배정 — admin_force_assign RPC(최대횟수만 우회, 사유 필수). */
export function useForceAssign(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      slotId,
      startupId,
      reason,
    }: {
      slotId: string;
      startupId: string;
      reason: string;
    }) => {
      const { error } = await supabase.rpc('admin_force_assign', {
        p_slot_id: slotId,
        p_startup_id: startupId,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: eventDetailKeys.slots(eventId) }),
  });
}

/** 관리자 강제 취소 — admin_force_cancel RPC(슬롯 즉시 공개, 사유 필수). */
export function useForceCancel(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ slotId, reason }: { slotId: string; reason: string }) => {
      const { error } = await supabase.rpc('admin_force_cancel', {
        p_slot_id: slotId,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: eventDetailKeys.slots(eventId) }),
  });
}

/** UNIQUE 위반(이미 참가자) 등을 사용자 메시지로 변환. */
function mapParticipantError(error: { code?: string; message: string }): Error {
  if (error.code === '23505') return new Error('이미 이 행사에 등록된 참가자가 포함되어 있습니다.');
  return new Error(error.message);
}

/** 테이블 코드 UNIQUE(event 내) 위반 변환. */
function mapTableError(error: { code?: string; message: string }): Error {
  if (error.code === '23505') return new Error('이미 같은 코드의 테이블이 있습니다.');
  return new Error(error.message);
}
