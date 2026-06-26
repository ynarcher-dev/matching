import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import type { CounselingAnswerRow } from '@/types/counselingLog';

/**
 * 상담일지 결과 조회 (관리자 리포트, operator supabase).
 * 출처: docs/counseling_log_customization.md §8.3.
 * RLS(0032): ADMIN 은 counseling_log_answers 를 전체 SELECT 하고, counseling_logs 는
 * 0003 clog_select 로 ADMIN 전체 SELECT 가능. 행 기준은 counseling_logs + matching_slots.
 * 문항 정의는 useEventCounselingQuestions(useCounselingBuilder) 를 재사용한다.
 */

/** 상담일지 1건(+슬롯 메타 +답변). 전문가/스타트업 식별은 userById 로 해석한다. */
export interface ReportCounselingLog {
  id: string;
  submitted_at: string | null;
  follow_up_required: boolean;
  follow_up_memo: string | null;
  is_public: boolean;
  expert_id: string | null;
  startup_id: string | null;
  start_time: string;
  session_status: string;
  answers: CounselingAnswerRow[];
}

interface RawSlot {
  id: string;
  event_id: string;
  expert_id: string | null;
  startup_id: string | null;
  start_time: string;
  session_status: string;
}

interface RawRow {
  id: string;
  submitted_at: string | null;
  follow_up_required: boolean;
  follow_up_memo: string | null;
  is_public: boolean;
  matching_slots: RawSlot | RawSlot[] | null;
  counseling_log_answers: CounselingAnswerRow[] | null;
}

export const counselingReportKeys = {
  logs: (eventId: string) => ['counseling-report', eventId, 'logs'] as const,
};

/** 이 행사의 모든 상담일지(+슬롯·답변)를 가져온다(상담 시작 시각 오름차순). */
export function useCounselingReport(eventId: string) {
  return useQuery<ReportCounselingLog[]>({
    queryKey: counselingReportKeys.logs(eventId),
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('counseling_logs')
        .select(
          'id,submitted_at,follow_up_required,follow_up_memo,is_public,' +
            'matching_slots!inner(id,event_id,expert_id,startup_id,start_time,session_status),' +
            'counseling_log_answers(question_id,answer_text,answer_rating,answer_selections)',
        )
        .eq('matching_slots.event_id', eventId);
      if (error) throw error;

      const rows = ((data as unknown as RawRow[] | null) ?? []).map((r) => {
        const slot = Array.isArray(r.matching_slots) ? r.matching_slots[0] : r.matching_slots;
        return {
          id: r.id,
          submitted_at: r.submitted_at,
          follow_up_required: r.follow_up_required,
          follow_up_memo: r.follow_up_memo,
          is_public: r.is_public,
          expert_id: slot?.expert_id ?? null,
          startup_id: slot?.startup_id ?? null,
          start_time: slot?.start_time ?? '',
          session_status: slot?.session_status ?? '',
          answers: r.counseling_log_answers ?? [],
        } satisfies ReportCounselingLog;
      });
      rows.sort((a, b) => a.start_time.localeCompare(b.start_time));
      return rows;
    },
  });
}
