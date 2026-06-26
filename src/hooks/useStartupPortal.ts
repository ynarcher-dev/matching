import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { participantClient } from '@/lib/participantClient';
import type { EventRow } from '@/types/event';
import type { MatchingSlotRow } from '@/types/eventDetail';
import type { PortalExpert } from '@/types/startupBooking';

/**
 * 스타트업 예약 포탈 데이터 (page_startup_booking.md).
 * 참가자 커스텀 JWT 경로이므로 모든 쿼리/RPC 는 participantClient 를 쓴다(운영진 supabase 와 분리).
 * 조회는 RLS 가 본인 참가 행사로 자동 제한하고, 쓰기는 book/change/cancel RPC 가 최종 검증한다.
 */

/** 포탈에서 쓰는 events 컬럼(목록 카드 + 예약 가능 판정). */
const EVENT_COLUMNS =
  'id,title,status,status_override,status_override_reason,booking_start,booking_end,' +
  'event_start,event_end,max_sessions_per_startup,allow_startup_self_booking,' +
  'allow_duplicate_expert,timezone,created_at';

/** 슬롯 실시간 갱신 폴링 간격(ms). 예약/취소 즉시 공개 반영. */
export const PORTAL_POLL_MS = 10000;

export const portalKeys = {
  events: ['portal', 'events'] as const,
  experts: (eventId: string) => ['portal', 'experts', eventId] as const,
  tables: (eventId: string) => ['portal', 'tables', eventId] as const,
  slots: (eventId: string) => ['portal', 'slots', eventId] as const,
};

/** 내가 참가한 활성 행사 목록(RLS 자동 제한). DRAFT/CANCELLED 제외, 행사 시작순. */
export function useMyEvents() {
  return useQuery<EventRow[]>({
    queryKey: portalKeys.events,
    queryFn: async () => {
      const { data, error } = await participantClient
        .from('events')
        .select(EVENT_COLUMNS)
        .is('deleted_at', null)
        .in('status', ['BOOKING', 'ALLOCATION', 'PROGRESS', 'FINISHED'])
        .order('event_start', { ascending: true })
        .returns<EventRow[]>();
      if (error) throw error;
      return data ?? [];
    },
  });
}

interface ExpertParticipantRow {
  user_id: string;
  default_table_id: string | null;
}
interface ExpertUserRow {
  id: string;
  name: string;
  expert_organization: string | null;
  expert_position: string | null;
  expert_description: string | null;
}
interface UserFieldRow {
  user_id: string;
  field_id: string;
}
interface FieldRow {
  id: string;
  name: string;
}

/**
 * 행사 참가 전문가 목록 + 프로필·분야·기본 테이블.
 * event_participants(EXPERT) → users(co-participant SELECT) → user_fields + fields 를 병합.
 */
export function useEventExperts(eventId: string) {
  return useQuery<PortalExpert[]>({
    queryKey: portalKeys.experts(eventId),
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data: parts, error: e1 } = await participantClient
        .from('event_participants')
        .select('user_id,default_table_id')
        .eq('event_id', eventId)
        .eq('participant_type', 'EXPERT')
        .returns<ExpertParticipantRow[]>();
      if (e1) throw e1;
      const expertIds = (parts ?? []).map((p) => p.user_id);
      if (expertIds.length === 0) return [];

      const [usersRes, ufRes, fieldsRes] = await Promise.all([
        participantClient
          .from('users')
          .select('id,name,expert_organization,expert_position,expert_description')
          .in('id', expertIds)
          .returns<ExpertUserRow[]>(),
        participantClient
          .from('user_fields')
          .select('user_id,field_id')
          .in('user_id', expertIds)
          .returns<UserFieldRow[]>(),
        participantClient.from('fields').select('id,name').returns<FieldRow[]>(),
      ]);
      if (usersRes.error) throw usersRes.error;
      if (ufRes.error) throw ufRes.error;
      if (fieldsRes.error) throw fieldsRes.error;

      const userById = new Map((usersRes.data ?? []).map((u) => [u.id, u]));
      const fieldName = new Map((fieldsRes.data ?? []).map((f) => [f.id, f.name]));
      const fieldsByUser = new Map<string, string[]>();
      for (const uf of ufRes.data ?? []) {
        const name = fieldName.get(uf.field_id);
        if (!name) continue;
        const list = fieldsByUser.get(uf.user_id);
        if (list) list.push(name);
        else fieldsByUser.set(uf.user_id, [name]);
      }

      return (parts ?? []).map((p) => {
        const u = userById.get(p.user_id);
        return {
          userId: p.user_id,
          name: u?.name ?? '(알 수 없는 전문가)',
          organization: u?.expert_organization ?? null,
          position: u?.expert_position ?? null,
          description: u?.expert_description ?? null,
          defaultTableId: p.default_table_id,
          fieldNames: fieldsByUser.get(p.user_id) ?? [],
        } satisfies PortalExpert;
      });
    },
  });
}

/** 행사장 테이블 코드 맵(슬롯 위치 표기용). id→table_code. */
export function useEventTableCodes(eventId: string) {
  return useQuery<Map<string, string>>({
    queryKey: portalKeys.tables(eventId),
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await participantClient
        .from('event_tables')
        .select('id,table_code')
        .eq('event_id', eventId)
        .returns<{ id: string; table_code: string }[]>();
      if (error) throw error;
      return new Map((data ?? []).map((t) => [t.id, t.table_code]));
    },
  });
}

/** 행사 매칭 슬롯 목록(시간순). 폴링으로 타 기업의 예약/취소를 근실시간 반영. */
export function useEventSlots(eventId: string, opts?: { refetchInterval?: number }) {
  return useQuery<MatchingSlotRow[]>({
    queryKey: portalKeys.slots(eventId),
    enabled: Boolean(eventId),
    refetchInterval: opts?.refetchInterval ?? false,
    queryFn: async () => {
      const { data, error } = await participantClient
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

/** RPC 예외 메시지(RAISE EXCEPTION 의 한국어 본문)를 사용자 메시지로 전달. */
function rpcError(error: { message: string }): Error {
  return new Error(error.message || '요청을 처리하지 못했습니다.');
}

/** 슬롯 예약 신청 — book_slot RPC(BOOKING 단계, 본인). */
export function useBookSlot(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slotId: string) => {
      const { error } = await participantClient.rpc('book_slot', { p_slot_id: slotId });
      if (error) throw rpcError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: portalKeys.slots(eventId) }),
  });
}

/** 예약 시간 변경 — change_booking RPC(기존 해제 + 신규 예약 단일 트랜잭션). */
export function useChangeBooking(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ fromSlotId, toSlotId }: { fromSlotId: string; toSlotId: string }) => {
      const { error } = await participantClient.rpc('change_booking', {
        p_from_slot_id: fromSlotId,
        p_to_slot_id: toSlotId,
      });
      if (error) throw rpcError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: portalKeys.slots(eventId) }),
  });
}

/** 예약 취소 — cancel_booking RPC(슬롯 즉시 공개, 사유 선택). */
export function useCancelBooking(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ slotId, reason }: { slotId: string; reason?: string | null }) => {
      const { error } = await participantClient.rpc('cancel_booking', {
        p_slot_id: slotId,
        p_reason: reason?.trim() ? reason.trim() : null,
      });
      if (error) throw rpcError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: portalKeys.slots(eventId) }),
  });
}
