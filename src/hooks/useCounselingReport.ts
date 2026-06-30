import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import type { CounselingAnswerRow } from '@/types/counselingLog';

/**
 * 상담일지 결과 조회 (관리자 리포트, operator supabase).
 * 출처: docs/counseling_log_customization.md §8.3.
 * RLS(0032): ADMIN 은 counseling_log_answers 를 전체 SELECT 하고, counseling_logs 는
 * 0003 clog_select 로 ADMIN 전체 SELECT 가능.
 * 행 기준은 "진행 대상 세션 전체"(matching_slots) 다 — 상담일지가 아직 작성되지 않은
 * 세션도 처음부터 모두 보여주고, 작성 여부(session_status=COMPLETED)로 완료를 판정한다.
 * 문항 정의는 useEventCounselingQuestions(useCounselingBuilder) 를 재사용한다.
 */

/**
 * 진행 대상 세션 1건(+상담일지 메타·답변). 일지 미작성 세션은 로그 필드가 기본값이다.
 * id 는 슬롯 id(목록 rowKey). 전문가/스타트업 식별은 userById 로 해석한다.
 */
export interface ReportCounselingLog {
  id: string;
  submitted_at: string | null;
  follow_up_required: boolean;
  follow_up_memo: string | null;
  is_public: boolean;
  expert_id: string | null;
  startup_id: string | null;
  start_time: string;
  end_time: string;
  session_status: string;
  answers: CounselingAnswerRow[];
}

interface RawLog {
  submitted_at: string | null;
  follow_up_required: boolean;
  follow_up_memo: string | null;
  is_public: boolean;
  counseling_log_answers: CounselingAnswerRow[] | null;
}

interface RawSlotRow {
  id: string;
  expert_id: string | null;
  startup_id: string | null;
  start_time: string;
  end_time: string;
  session_status: string;
  counseling_logs: RawLog | RawLog[] | null;
}

export const counselingReportKeys = {
  logs: (eventId: string) => ['counseling-report', eventId, 'logs'] as const,
};

/**
 * 이 행사의 진행 대상 세션 전체(+작성된 상담일지·답변)를 가져온다(상담 시작 시각 오름차순).
 * 스타트업이 배정된 세션만(빈 슬롯 제외), 취소 세션은 진행 대상이 아니므로 제외한다.
 */
export function useCounselingReport(eventId: string) {
  return useQuery<ReportCounselingLog[]>({
    queryKey: counselingReportKeys.logs(eventId),
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matching_slots')
        .select(
          'id,expert_id,startup_id,start_time,end_time,session_status,' +
            'counseling_logs(submitted_at,follow_up_required,follow_up_memo,is_public,' +
            'counseling_log_answers(question_id,answer_text,answer_rating,answer_selections))',
        )
        .eq('event_id', eventId)
        .not('startup_id', 'is', null)
        .neq('session_status', 'CANCELLED');
      if (error) throw error;

      const rows = ((data as unknown as RawSlotRow[] | null) ?? []).map((r) => {
        const log = Array.isArray(r.counseling_logs) ? r.counseling_logs[0] : r.counseling_logs;
        return {
          id: r.id,
          submitted_at: log?.submitted_at ?? null,
          follow_up_required: log?.follow_up_required ?? false,
          follow_up_memo: log?.follow_up_memo ?? null,
          is_public: log?.is_public ?? false,
          expert_id: r.expert_id,
          startup_id: r.startup_id,
          start_time: r.start_time,
          end_time: r.end_time,
          session_status: r.session_status,
          answers: log?.counseling_log_answers ?? [],
        } satisfies ReportCounselingLog;
      });
      rows.sort((a, b) => a.start_time.localeCompare(b.start_time));
      return rows;
    },
  });
}
