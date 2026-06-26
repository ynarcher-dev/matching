import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { eventDetailKeys } from '@/hooks/useEventDetail';
import type { AttendanceLogRow, AttendanceStatus } from '@/types/attendance';
import type { ParticipantRole } from '@/types/user';

/**
 * 진행(PROGRESS) 단계 실시간 대시보드 데이터 (page_admin_event_detail.md §3.1).
 * 출석은 attendance_logs 직접 SELECT(관리자 RLS), 변경은 check_in / mark_no_show RPC.
 * "실시간"은 react-query refetchInterval 폴링으로 구현한다(별도 realtime 인프라 불필요).
 */

/** 진행 대시보드 폴링 주기(ms). 현장 모니터링용 근실시간 갱신. */
export const DASHBOARD_POLL_MS = 7000;

export const attendanceKeys = {
  byEvent: (eventId: string) => ['attendance', eventId] as const,
};

/**
 * 행사 슬롯들의 출석 로그 조회. attendance_logs 에는 event_id 가 없어 slot id 로 필터한다.
 * slotIds 가 비면 비활성(쿼리 미실행), 활성 시 폴링으로 근실시간 갱신.
 */
export function useSlotAttendance(eventId: string, slotIds: string[]) {
  return useQuery<AttendanceLogRow[]>({
    queryKey: attendanceKeys.byEvent(eventId),
    enabled: slotIds.length > 0,
    refetchInterval: slotIds.length > 0 ? DASHBOARD_POLL_MS : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attendance_logs')
        .select('id,matching_slot_id,user_id,role_type,attendance_status,checked_in_at')
        .in('matching_slot_id', slotIds)
        .order('checked_in_at', { ascending: false })
        .returns<AttendanceLogRow[]>();
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * 출석 체크/해제 — check_in RPC. 관리자 대시보드는 스타트업 출석을 원클릭 처리하고,
 * 전문가 출석은 본인만 가능(RPC 가 차단)하므로 표시만 한다. 수동(MANUAL) 처리라 사유 필수.
 */
export function useCheckIn(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      slotId: string;
      userId: string;
      roleType: ParticipantRole;
      status: AttendanceStatus;
      reason?: string;
    }) => {
      const { error } = await supabase.rpc('check_in', {
        p_slot_id: params.slotId,
        p_user_id: params.userId,
        p_role_type: params.roleType,
        p_attendance_status: params.status,
        p_check_in_type: 'MANUAL',
        p_reason: params.reason ?? '관리자 대시보드 출석 처리',
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: attendanceKeys.byEvent(eventId) }),
  });
}

/**
 * 출석 기록 삭제 — clear_attendance RPC. 실수로 누른 출석/불참을 기본(미정)으로 되돌린다.
 * attendance_status 에 "미정" 값이 없어 로그 자체를 삭제한다(권한은 check_in 과 동일).
 */
export function useClearAttendance(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      slotId: string;
      userId: string;
      roleType: ParticipantRole;
    }) => {
      const { error } = await supabase.rpc('clear_attendance', {
        p_slot_id: params.slotId,
        p_user_id: params.userId,
        p_role_type: params.roleType,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: attendanceKeys.byEvent(eventId) }),
  });
}

/** 노쇼 처리 — mark_no_show RPC(관리자, WAITING|IN_PROGRESS → NO_SHOW, 사유 필수). */
export function useMarkNoShow(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ slotId, reason }: { slotId: string; reason: string }) => {
      const { error } = await supabase.rpc('mark_no_show', {
        p_slot_id: slotId,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: eventDetailKeys.slots(eventId) }),
  });
}
