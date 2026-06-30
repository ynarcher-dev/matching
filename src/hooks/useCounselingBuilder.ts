import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { cleanOptions, needsOptions } from '@/lib/counselingBuilder';
import type { CounselingQuestion, CounselingQuestionInput } from '@/types/counselingLog';

/**
 * 상담일지 관리자 빌더 데이터 (operator supabase 클라이언트).
 * 출처: docs/counseling_log_customization.md §6.
 * RLS(0032): counseling_log_questions 는 ADMIN 이 INSERT/UPDATE/DELETE, answers 는 ADMIN SELECT.
 * 편집 잠금(답변 존재/단계)은 lib/counselingBuilder.canEditCounseling 가 판정한다.
 * ⭐system_key(레거시 매핑) 컬럼은 폼에서 다루지 않으므로 UPDATE 시에도 보존된다.
 */

export const counselingBuilderKeys = {
  questions: (eventId: string) => ['counseling-builder', eventId, 'questions'] as const,
  answerCount: (eventId: string) => ['counseling-builder', eventId, 'answer-count'] as const,
};

/** 행사의 모든 상담일지 문항(순서 정렬). */
export function useEventCounselingQuestions(eventId: string) {
  return useQuery<CounselingQuestion[]>({
    queryKey: counselingBuilderKeys.questions(eventId),
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
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

/** 이 행사에 작성된 상담일지 답변 수(편집 잠금 판정용). */
export function useEventCounselingAnswerCount(eventId: string) {
  return useQuery<number>({
    queryKey: counselingBuilderKeys.answerCount(eventId),
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { count, error } = await supabase
        .from('counseling_log_answers')
        .select('id,counseling_log_questions!inner(event_id)', { count: 'exact', head: true })
        .eq('counseling_log_questions.event_id', eventId);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

/** 입력값을 counseling_log_questions 컬럼 행으로 변환(event_id·system_key 제외). */
function toRow(input: CounselingQuestionInput) {
  return {
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
  return () => qc.invalidateQueries({ queryKey: counselingBuilderKeys.questions(eventId) });
}

/** 문항 추가 — counseling_log_questions INSERT(ADMIN RLS, system_key=NULL 커스텀). */
export function useCreateCounselingQuestion(eventId: string) {
  const invalidate = useInvalidateQuestions(eventId);
  return useMutation({
    mutationFn: async (input: CounselingQuestionInput) => {
      const { error } = await supabase
        .from('counseling_log_questions')
        .insert({ ...toRow(input), event_id: eventId });
      if (error) throw new Error(error.message || '문항을 추가하지 못했습니다.');
    },
    onSuccess: invalidate,
  });
}

/** 문항 수정 — counseling_log_questions UPDATE(updated_at 갱신, system_key 보존). */
export function useUpdateCounselingQuestion(eventId: string) {
  const invalidate = useInvalidateQuestions(eventId);
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: CounselingQuestionInput }) => {
      const { error } = await supabase
        .from('counseling_log_questions')
        .update({ ...toRow(input), updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw new Error(error.message || '문항을 수정하지 못했습니다.');
    },
    onSuccess: invalidate,
  });
}

/** 문항 삭제 — counseling_log_questions DELETE(답변은 FK RESTRICT 라 답변 없을 때만 가능). */
export function useDeleteCounselingQuestion(eventId: string) {
  const invalidate = useInvalidateQuestions(eventId);
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('counseling_log_questions').delete().eq('id', id);
      if (error) throw new Error(error.message || '문항을 삭제하지 못했습니다.');
    },
    onSuccess: invalidate,
  });
}

/**
 * 드래그앤드롭 재정렬 — 여러 문항의 order_no 를 한 번에 갱신한다.
 * 기존 order_no 값 집합을 새 순서에 그대로 재배치하므로 값 공간이 보존된다.
 * 낙관적 업데이트로 드롭 즉시 화면에 반영하고, 실패 시 롤백한다.
 */
export function useReorderCounselingQuestions(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (updates: { id: string; order_no: number }[]) => {
      if (updates.length === 0) return;
      const results = await Promise.all(
        updates.map((u) =>
          supabase.from('counseling_log_questions').update({ order_no: u.order_no }).eq('id', u.id),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw new Error(failed.error.message || '순서를 변경하지 못했습니다.');
    },
    onMutate: async (updates) => {
      await qc.cancelQueries({ queryKey: counselingBuilderKeys.questions(eventId) });
      const prev = qc.getQueryData<CounselingQuestion[]>(counselingBuilderKeys.questions(eventId));
      if (prev) {
        const next = new Map(updates.map((u) => [u.id, u.order_no]));
        qc.setQueryData<CounselingQuestion[]>(
          counselingBuilderKeys.questions(eventId),
          prev.map((q) => (next.has(q.id) ? { ...q, order_no: next.get(q.id)! } : q)),
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(counselingBuilderKeys.questions(eventId), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: counselingBuilderKeys.questions(eventId) }),
  });
}

/** 기본 템플릿 문항 일괄 추가 — counseling_log_questions INSERT(여러 행). */
export function useAddCounselingTemplate(eventId: string) {
  const invalidate = useInvalidateQuestions(eventId);
  return useMutation({
    mutationFn: async (inputs: CounselingQuestionInput[]) => {
      if (inputs.length === 0) return;
      const rows = inputs.map((i) => ({ ...toRow(i), event_id: eventId }));
      const { error } = await supabase.from('counseling_log_questions').insert(rows);
      if (error) throw new Error(error.message || '기본 문항을 추가하지 못했습니다.');
    },
    onSuccess: invalidate,
  });
}
