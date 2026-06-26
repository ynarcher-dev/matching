import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import type { SurveyAnswerRow } from '@/types/satisfaction';

/**
 * 만족도 조사 결과 조회 (관리자 리포트, operator supabase).
 * 출처: docs/survey_customization_ideation.md §3.2.
 * RLS(0025): ADMIN 은 survey_responses / survey_answers 를 전체 SELECT 할 수 있다.
 * 문항은 useEventSurveyQuestions(useSurveyBuilder) 를, 대상 인원은 참가자 목록을 재사용한다.
 */

/** 응답 1건(+답변). 응답자 식별은 user_id → userById(AssignableUser) 로 해석한다. */
export interface ReportResponse {
  id: string;
  user_id: string;
  user_role: 'STARTUP' | 'EXPERT';
  submitted_at: string;
  answers: SurveyAnswerRow[];
}

export const surveyReportKeys = {
  responses: (eventId: string) => ['survey-report', eventId, 'responses'] as const,
};

/** 이 행사의 모든 제출 응답(+답변)을 가져온다(제출 시각 내림차순). */
export function useSurveyReport(eventId: string) {
  return useQuery<ReportResponse[]>({
    queryKey: surveyReportKeys.responses(eventId),
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('survey_responses')
        .select(
          'id,user_id,user_role,submitted_at,survey_answers(question_id,answer_text,answer_rating,answer_selections)',
        )
        .eq('event_id', eventId)
        .order('submitted_at', { ascending: false });
      if (error) throw error;
      return (
        (data as
          | {
              id: string;
              user_id: string;
              user_role: 'STARTUP' | 'EXPERT';
              submitted_at: string;
              survey_answers: SurveyAnswerRow[] | null;
            }[]
          | null) ?? []
      ).map((r) => ({
        id: r.id,
        user_id: r.user_id,
        user_role: r.user_role,
        submitted_at: r.submitted_at,
        answers: r.survey_answers ?? [],
      }));
    },
  });
}
