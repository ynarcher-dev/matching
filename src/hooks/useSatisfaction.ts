import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { participantClient } from '@/lib/participantClient';
import { surveyAnswersSchema } from '@/schemas/satisfactionSchemas';
import type {
  ConsultedExpertSlot,
  MyExpertSurveyResponse,
  MySurveyResponse,
  PublicComment,
  SurveyAnswerInput,
  SurveyAnswerRow,
  SurveyQuestion,
  SurveyScope,
  SurveyTargetRole,
} from '@/types/satisfaction';

/**
 * 만족도 조사(동적 문항)·공개 상담 코멘트 데이터.
 * 출처: docs/survey_customization_ideation.md §2~§4.
 * 참가자 커스텀 JWT 경로이므로 participantClient 를 쓴다(운영진 supabase 와 분리).
 * - 문항/내 응답 조회: RLS survey_q_select / survey_r_select / survey_a_select 가 권위.
 * - 제출: submit_survey RPC 가 응답+답변을 원자적으로 저장(서버 재검증).
 * - 공개 코멘트: list_public_comments RPC 가 점수 제외하고 본인 공개분만 반환.
 */

export const satisfactionKeys = {
  questions: (eventId: string, scope: SurveyScope) =>
    ['portal', 'survey-questions', eventId, scope] as const,
  response: (eventId: string) => ['portal', 'survey-response', eventId] as const,
  comments: (eventId: string) => ['portal', 'comments', eventId] as const,
  consultedExperts: (eventId: string) => ['portal', 'consulted-experts', eventId] as const,
  expertResponses: (eventId: string) => ['portal', 'expert-survey-responses', eventId] as const,
};

/**
 * 이 행사·스코프에서 내 역할 대상 + 공통(ALL) 문항을 순서대로.
 * scope='EVENT'(기본): 행사 만족도 / scope='EXPERT': 전문가 만족도(스타트업이 전문가별 응답).
 */
export function useSurveyQuestions(
  eventId: string,
  role: SurveyTargetRole,
  scope: SurveyScope = 'EVENT',
) {
  return useQuery<SurveyQuestion[]>({
    queryKey: satisfactionKeys.questions(eventId, scope),
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await participantClient
        .from('survey_questions')
        .select(
          'id,event_id,survey_scope,target_role,question_type,title,description,options,is_required,order_no',
        )
        .eq('event_id', eventId)
        .eq('survey_scope', scope)
        .in('target_role', [role, 'ALL'])
        .order('order_no', { ascending: true });
      if (error) throw error;
      return (data as SurveyQuestion[] | null) ?? [];
    },
  });
}

/** 내가 이 행사에 제출한 응답(+답변). 미제출이면 null. RLS 가 본인 행으로 제한. */
export function useMySurveyResponse(eventId: string) {
  return useQuery<MySurveyResponse | null>({
    queryKey: satisfactionKeys.response(eventId),
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await participantClient
        .from('survey_responses')
        .select(
          'id,event_id,submitted_at,survey_answers(question_id,answer_text,answer_rating,answer_selections)',
        )
        .eq('event_id', eventId)
        .eq('survey_scope', 'EVENT')
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as {
        id: string;
        event_id: string;
        submitted_at: string;
        survey_answers: SurveyAnswerRow[] | null;
      };
      return {
        id: row.id,
        event_id: row.event_id,
        submitted_at: row.submitted_at,
        answers: row.survey_answers ?? [],
      };
    },
  });
}

/** 만족도 제출 — submit_survey RPC(응답+답변 원자적, 1회·수정 불가). */
export function useSubmitSurvey(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (answers: SurveyAnswerInput[]) => {
      const payload = surveyAnswersSchema.parse(answers);
      const { error } = await participantClient.rpc('submit_survey', {
        p_event_id: eventId,
        p_answers: payload,
      });
      if (error) {
        // 23505 = 이미 제출(동시 제출 방어). RPC 가 친절 메시지를 함께 던진다.
        if (error.code === '23505') {
          throw new Error('이미 만족도 조사를 제출하셨습니다.');
        }
        throw new Error(error.message || '만족도 조사를 제출하지 못했습니다.');
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: satisfactionKeys.response(eventId) }),
  });
}

/**
 * 전문가별 만족도 — 내가 응답 가능한 상담 슬롯 목록(취소·노쇼 제외 + 응답 여부).
 * list_my_consulted_experts RPC 가 서버에서 자격·전문가 이름·중복 여부를 모아 반환한다.
 */
export function useConsultedExperts(eventId: string) {
  return useQuery<ConsultedExpertSlot[]>({
    queryKey: satisfactionKeys.consultedExperts(eventId),
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await participantClient.rpc('list_my_consulted_experts', {
        p_event_id: eventId,
      });
      if (error) throw error;
      return (data as ConsultedExpertSlot[] | null) ?? [];
    },
  });
}

/** 내가 이 행사에서 제출한 전문가 만족도(슬롯 단위, +답변). RLS 가 본인 행으로 제한. */
export function useMyExpertSurveyResponses(eventId: string) {
  return useQuery<MyExpertSurveyResponse[]>({
    queryKey: satisfactionKeys.expertResponses(eventId),
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await participantClient
        .from('survey_responses')
        .select(
          'id,slot_id,target_expert_id,submitted_at,survey_answers(question_id,answer_text,answer_rating,answer_selections)',
        )
        .eq('event_id', eventId)
        .eq('survey_scope', 'EXPERT');
      if (error) throw error;
      return (
        (data as
          | {
              id: string;
              slot_id: string;
              target_expert_id: string;
              submitted_at: string;
              survey_answers: SurveyAnswerRow[] | null;
            }[]
          | null) ?? []
      ).map((r) => ({
        id: r.id,
        slot_id: r.slot_id,
        target_expert_id: r.target_expert_id,
        submitted_at: r.submitted_at,
        answers: r.survey_answers ?? [],
      }));
    },
  });
}

/** 전문가 만족도 제출 — submit_expert_survey RPC(슬롯 단위 원자적, 슬롯당 1회·수정 불가). */
export function useSubmitExpertSurvey(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ slotId, answers }: { slotId: string; answers: SurveyAnswerInput[] }) => {
      const payload = surveyAnswersSchema.parse(answers);
      const { error } = await participantClient.rpc('submit_expert_survey', {
        p_event_id: eventId,
        p_slot_id: slotId,
        p_answers: payload,
      });
      if (error) {
        if (error.code === '23505') {
          throw new Error('이미 이 상담에 대한 만족도를 제출하셨습니다.');
        }
        throw new Error(error.message || '전문가 만족도를 제출하지 못했습니다.');
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: satisfactionKeys.consultedExperts(eventId) });
      qc.invalidateQueries({ queryKey: satisfactionKeys.expertResponses(eventId) });
    },
  });
}

/** 전문가가 공개를 허용한 본인 상담 텍스트 코멘트(점수 제외). */
export function usePublicComments(eventId: string) {
  return useQuery<PublicComment[]>({
    queryKey: satisfactionKeys.comments(eventId),
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await participantClient.rpc('list_public_comments', {
        p_event_id: eventId,
      });
      if (error) throw error;
      return (data as PublicComment[] | null) ?? [];
    },
  });
}
