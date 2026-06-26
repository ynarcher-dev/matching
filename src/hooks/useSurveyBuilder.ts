import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { cleanOptions, needsOptions } from '@/lib/surveyBuilder';
import type { SurveyQuestion, SurveyQuestionInput } from '@/types/satisfaction';

/**
 * 만족도 조사 관리자 빌더 데이터 (operator supabase 클라이언트).
 * 출처: docs/survey_customization_ideation.md §3.
 * RLS(0025): survey_questions 는 ADMIN 이 INSERT/UPDATE/DELETE 가능, responses 는 ADMIN SELECT.
 * 편집 잠금(응답 존재/단계)은 lib/surveyBuilder.canEditSurvey 가 판정한다.
 */

export const surveyBuilderKeys = {
  questions: (eventId: string) => ['survey-builder', eventId, 'questions'] as const,
  responseCount: (eventId: string) => ['survey-builder', eventId, 'response-count'] as const,
};

/** 행사의 모든 만족도 문항(역할·순서 정렬). 빌더가 탭으로 분리해 보여준다. */
export function useEventSurveyQuestions(eventId: string) {
  return useQuery<SurveyQuestion[]>({
    queryKey: surveyBuilderKeys.questions(eventId),
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('survey_questions')
        .select(
          'id,event_id,target_role,question_type,title,description,options,is_required,order_no',
        )
        .eq('event_id', eventId)
        .order('target_role', { ascending: true })
        .order('order_no', { ascending: true })
        .returns<SurveyQuestion[]>();
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** 이 행사에 제출된 응답 수(편집 잠금 판정용). */
export function useEventSurveyResponseCount(eventId: string) {
  return useQuery<number>({
    queryKey: surveyBuilderKeys.responseCount(eventId),
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { count, error } = await supabase
        .from('survey_responses')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', eventId);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

/** 입력값을 survey_questions 컬럼 행으로 변환(event_id 제외 — 객관식만 옵션 보존). */
function toRow(input: SurveyQuestionInput) {
  return {
    target_role: input.target_role,
    question_type: input.question_type,
    title: input.title.trim(),
    description: input.description?.trim() ? input.description.trim() : null,
    options: needsOptions(input.question_type) ? cleanOptions(input.options ?? []) : null,
    is_required: input.is_required,
    order_no: input.order_no,
  };
}

function useInvalidateQuestions(eventId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: surveyBuilderKeys.questions(eventId) });
}

/** 문항 추가 — survey_questions INSERT(ADMIN RLS). */
export function useCreateQuestion(eventId: string) {
  const invalidate = useInvalidateQuestions(eventId);
  return useMutation({
    mutationFn: async (input: SurveyQuestionInput) => {
      const { error } = await supabase
        .from('survey_questions')
        .insert({ ...toRow(input), event_id: eventId });
      if (error) throw new Error(error.message || '문항을 추가하지 못했습니다.');
    },
    onSuccess: invalidate,
  });
}

/** 문항 수정 — survey_questions UPDATE(updated_at 갱신). */
export function useUpdateQuestion(eventId: string) {
  const invalidate = useInvalidateQuestions(eventId);
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: SurveyQuestionInput }) => {
      const { error } = await supabase
        .from('survey_questions')
        .update({ ...toRow(input), updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw new Error(error.message || '문항을 수정하지 못했습니다.');
    },
    onSuccess: invalidate,
  });
}

/** 문항 삭제 — survey_questions DELETE(답변은 FK CASCADE). */
export function useDeleteQuestion(eventId: string) {
  const invalidate = useInvalidateQuestions(eventId);
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('survey_questions').delete().eq('id', id);
      if (error) throw new Error(error.message || '문항을 삭제하지 못했습니다.');
    },
    onSuccess: invalidate,
  });
}

/** 두 문항의 순서(order_no)를 맞바꾼다(▲/▼ 이동). */
export function useSwapQuestionOrder(eventId: string) {
  const invalidate = useInvalidateQuestions(eventId);
  return useMutation({
    mutationFn: async (pair: [{ id: string; order_no: number }, { id: string; order_no: number }]) => {
      const [a, b] = pair;
      const r1 = await supabase.from('survey_questions').update({ order_no: b.order_no }).eq('id', a.id);
      if (r1.error) throw new Error(r1.error.message);
      const r2 = await supabase.from('survey_questions').update({ order_no: a.order_no }).eq('id', b.id);
      if (r2.error) throw new Error(r2.error.message);
    },
    onSuccess: invalidate,
  });
}

/** 기본 템플릿 문항 일괄 추가 — survey_questions INSERT(여러 행). */
export function useAddTemplateQuestions(eventId: string) {
  const invalidate = useInvalidateQuestions(eventId);
  return useMutation({
    mutationFn: async (inputs: SurveyQuestionInput[]) => {
      if (inputs.length === 0) return;
      const rows = inputs.map((i) => ({ ...toRow(i), event_id: eventId }));
      const { error } = await supabase.from('survey_questions').insert(rows);
      if (error) throw new Error(error.message || '기본 문항을 추가하지 못했습니다.');
    },
    onSuccess: invalidate,
  });
}
