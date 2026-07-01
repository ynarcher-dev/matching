import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { participantClient } from '@/lib/participantClient';
import { createSignedUrlWithClient } from '@/lib/storage';
import type { EventRow } from '@/types/event';
import type { MatchingSlotRow } from '@/types/eventDetail';
import type { AttendanceLogRow, AttendanceStatus } from '@/types/attendance';
import type { ParticipantRole } from '@/types/user';
import type { CounselingLogRow, SlotStartup } from '@/types/expert';
import type { CounselingAnswerRow, CounselingQuestion } from '@/types/counselingLog';
import type { CounselingDraft } from '@/lib/counseling';
import { toRpcArgsV2 } from '@/lib/counseling';

/**
 * 전문가 대시보드 데이터 (docs/page_expert_dashboard.md §1~2).
 * 전문가도 OTP 커스텀 JWT 경로이므로 모든 쿼리/RPC 는 participantClient 를 쓴다.
 * 조회는 RLS 가 본인 슬롯/참가 행사로 자동 제한하고, 쓰기는 세션 RPC(0005/0019/0020)가
 * 권한·상태 전이를 최종 검증한다.
 */

/** 대시보드 근실시간 갱신 폴링 간격(ms). */
export const EXPERT_POLL_MS = 10000;

/** 포탈에서 쓰는 events 컬럼(헤더 + 단계 판정). */
const EVENT_COLUMNS =
  'id,title,status,status_override,status_override_reason,booking_start,booking_end,' +
  'event_start,event_end,max_sessions_per_startup,allow_startup_self_booking,' +
  'allow_duplicate_expert,timezone,created_at';

export const expertKeys = {
  events: ['expert', 'events'] as const,
  slots: (eventId: string) => ['expert', 'slots', eventId] as const,
  startups: (eventId: string) => ['expert', 'startups', eventId] as const,
  attendance: (eventId: string) => ['expert', 'attendance', eventId] as const,
  log: (slotId: string) => ['expert', 'log', slotId] as const,
  questions: (eventId: string) => ['expert', 'clog-questions', eventId] as const,
};

/** 행사의 상담일지 문항 정의(순서 정렬). RLS(0032)가 참가자 SELECT 를 허용한다. */
export function useCounselingLogQuestions(eventId: string, enabled = true) {
  return useQuery<CounselingQuestion[]>({
    queryKey: expertKeys.questions(eventId),
    enabled: Boolean(eventId) && enabled,
    queryFn: async () => {
      const { data, error } = await participantClient
        .from('counseling_log_questions')
        .select('id,event_id,question_type,title,description,options,is_required,order_no,system_key')
        .eq('event_id', eventId)
        .order('order_no', { ascending: true })
        .returns<CounselingQuestion[]>();
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** 내가 전문가로 참가한 활성 행사 목록(RLS 자동 제한). DRAFT/CANCELLED 제외, 행사 시작순. */
export function useMyExpertEvents() {
  return useQuery<EventRow[]>({
    queryKey: expertKeys.events,
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

/** 본인 담당 슬롯 목록(시간순). 폴링으로 출석/세션 상태를 근실시간 반영. */
export function useMyExpertSlots(eventId: string, myId: string) {
  return useQuery<MatchingSlotRow[]>({
    queryKey: expertKeys.slots(eventId),
    enabled: Boolean(eventId && myId),
    refetchInterval: EXPERT_POLL_MS,
    queryFn: async () => {
      const { data, error } = await participantClient
        .from('matching_slots')
        .select(
          'id,event_id,expert_id,startup_id,start_time,end_time,table_id,booking_type,session_status,counseling_request',
        )
        .eq('event_id', eventId)
        .eq('expert_id', myId)
        .order('start_time', { ascending: true })
        .returns<MatchingSlotRow[]>();
      if (error) throw error;
      return data ?? [];
    },
  });
}

interface StartupUserRow {
  id: string;
  name: string;
  company_name: string | null;
  representative_name: string | null;
  company_description: string | null;
  company_homepage: string | null;
  proposal_file_url: string | null;
  proposal_file_name: string | null;
  /** 참고 URL 링크(company_links 임베드, created_at 순). RLS co-participant SELECT(0074). */
  company_links: { id: string; url: string; label: string | null; created_at: string }[] | null;
}

/** 내 슬롯에 배정된 스타트업 요약(id→SlotStartup). RLS 가 co-participant SELECT 로 허용. */
export function useSlotStartups(eventId: string, startupIds: string[]) {
  const sortedIds = startupIds.slice().sort();
  return useQuery<Map<string, SlotStartup>>({
    queryKey: [...expertKeys.startups(eventId), sortedIds.join(',')],
    enabled: startupIds.length > 0,
    queryFn: async () => {
      const { data, error } = await participantClient
        .from('users')
        .select(
          'id,name,company_name,representative_name,company_description,company_homepage,proposal_file_url,proposal_file_name,company_links(id,url,label,created_at)',
        )
        .in('id', startupIds)
        .returns<StartupUserRow[]>();
      if (error) throw error;
      return new Map(
        (data ?? []).map((u) => [
          u.id,
          {
            id: u.id,
            name: u.name,
            companyName: u.company_name,
            representativeName: u.representative_name,
            description: u.company_description,
            homepage: u.company_homepage,
            links: (u.company_links ?? [])
              .slice()
              .sort((a, b) => a.created_at.localeCompare(b.created_at))
              .map((l) => ({ id: l.id, url: l.url, label: l.label })),
            proposalFileUrl: u.proposal_file_url,
            proposalFileName: u.proposal_file_name,
          } satisfies SlotStartup,
        ]),
      );
    },
  });
}

/** 행사장 테이블 코드 맵(슬롯 위치 표기용). id→table_code. */
export function useExpertTableCodes(eventId: string) {
  return useQuery<Map<string, string>>({
    queryKey: ['expert', 'tables', eventId],
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

/** 내 슬롯들의 출석 로그(본인·담당 스타트업, RLS 허용). 폴링으로 근실시간 갱신. */
export function useExpertAttendance(eventId: string, slotIds: string[]) {
  return useQuery<AttendanceLogRow[]>({
    queryKey: expertKeys.attendance(eventId),
    enabled: slotIds.length > 0,
    refetchInterval: slotIds.length > 0 ? EXPERT_POLL_MS : false,
    queryFn: async () => {
      const { data, error } = await participantClient
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

/** RPC 예외 메시지(RAISE EXCEPTION 의 한국어 본문)를 사용자 메시지로 전달. */
function rpcError(error: { message: string }): Error {
  return new Error(error.message || '요청을 처리하지 못했습니다.');
}

/** 상담 시작 — start_counseling RPC(전문가 본인, WAITING → IN_PROGRESS). */
export function useStartCounseling(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slotId: string) => {
      const { error } = await participantClient.rpc('start_counseling', { p_slot_id: slotId });
      if (error) throw rpcError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: expertKeys.slots(eventId) }),
  });
}

/**
 * 출석 체크 — check_in RPC. 본인(EXPERT) 출석과 담당 스타트업(STARTUP) 출석을 처리.
 * 대시보드 직접 체크는 수동(MANUAL)이라 사유를 함께 보낸다.
 */
export function useExpertCheckIn(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      slotId: string;
      userId: string;
      roleType: ParticipantRole;
      status: AttendanceStatus;
    }) => {
      const { error } = await participantClient.rpc('check_in', {
        p_slot_id: params.slotId,
        p_user_id: params.userId,
        p_role_type: params.roleType,
        p_attendance_status: params.status,
        p_check_in_type: 'MANUAL',
        p_reason: '전문가 대시보드 출석 처리',
      });
      if (error) throw rpcError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: expertKeys.attendance(eventId) }),
  });
}

/** 출석 기록 삭제 — clear_attendance RPC. 실수로 누른 출석/불참을 기본(미정)으로 되돌린다. */
export function useExpertClearAttendance(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { slotId: string; userId: string; roleType: ParticipantRole }) => {
      const { error } = await participantClient.rpc('clear_attendance', {
        p_slot_id: params.slotId,
        p_user_id: params.userId,
        p_role_type: params.roleType,
      });
      if (error) throw rpcError(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: expertKeys.attendance(eventId) }),
  });
}

/** 슬롯의 상담일지 마스터 + 동적 답변(없으면 log=null). RLS 가 작성 전문가에게만 노출한다. */
export interface CounselingLogBundle {
  log: CounselingLogRow | null;
  answers: CounselingAnswerRow[];
}

export function useCounselingLog(slotId: string, enabled = true) {
  return useQuery<CounselingLogBundle>({
    queryKey: expertKeys.log(slotId),
    enabled: Boolean(slotId) && enabled,
    queryFn: async () => {
      const { data, error } = await participantClient
        .from('counseling_logs')
        .select(
          'id,matching_slot_id,score_technology,score_expertise,score_reliability,' +
            'score_collaboration,score_probability,content,follow_up_required,follow_up_memo,' +
            'is_public,submitted_at,updated_at,' +
            'counseling_log_answers(question_id,answer_text,answer_rating,answer_selections)',
        )
        .eq('matching_slot_id', slotId)
        .maybeSingle()
        .returns<(CounselingLogRow & { counseling_log_answers: CounselingAnswerRow[] | null }) | null>();
      if (error) throw error;
      if (!data) return { log: null, answers: [] };
      const { counseling_log_answers, ...log } = data;
      return { log, answers: counseling_log_answers ?? [] };
    },
  });
}

/** 상담일지 임시저장 — save_counseling_log_draft_v2 RPC(부분 입력 허용, 세션 미완료). */
export function useSaveCounselingDraft(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      slotId,
      questions,
      draft,
    }: {
      slotId: string;
      questions: CounselingQuestion[];
      draft: CounselingDraft;
    }) => {
      const { error } = await participantClient.rpc(
        'save_counseling_log_draft_v2',
        toRpcArgsV2(slotId, questions, draft),
      );
      if (error) throw rpcError(error);
    },
    onSuccess: (_d, { slotId }) => {
      qc.invalidateQueries({ queryKey: expertKeys.log(slotId) });
      qc.invalidateQueries({ queryKey: expertKeys.slots(eventId) });
    },
  });
}

/** 상담일지 최종 제출 — submit_counseling_log_v2 RPC(필수 문항 검증, COMPLETED 전환·수정 이력). */
export function useSubmitCounselingLog(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      slotId,
      questions,
      draft,
    }: {
      slotId: string;
      questions: CounselingQuestion[];
      draft: CounselingDraft;
    }) => {
      const { error } = await participantClient.rpc(
        'submit_counseling_log_v2',
        toRpcArgsV2(slotId, questions, draft),
      );
      if (error) throw rpcError(error);
    },
    onSuccess: (_d, { slotId }) => {
      qc.invalidateQueries({ queryKey: expertKeys.log(slotId) });
      qc.invalidateQueries({ queryKey: expertKeys.slots(eventId) });
    },
  });
}

/**
 * 상담일지 제출 취소 — reopen_counseling_log_v2 RPC(COMPLETED → IN_PROGRESS).
 * 작성 내용은 보존하고 세션만 진행 중으로 되돌려 재편집/재제출을 가능하게 한다.
 */
export function useReopenCounselingLog(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slotId: string) => {
      const { error } = await participantClient.rpc('reopen_counseling_log_v2', {
        p_slot_id: slotId,
      });
      if (error) throw rpcError(error);
    },
    onSuccess: (_d, slotId) => {
      qc.invalidateQueries({ queryKey: expertKeys.log(slotId) });
      qc.invalidateQueries({ queryKey: expertKeys.slots(eventId) });
    },
  });
}

/** 스타트업 사업소개서의 단기 Signed URL 을 생성한다(participantClient·RLS 적용). */
export async function getProposalSignedUrl(path: string): Promise<string> {
  return createSignedUrlWithClient(participantClient, path, 120);
}
