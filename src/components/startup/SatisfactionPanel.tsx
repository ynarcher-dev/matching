import { useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { Spinner } from '@/components/common/Spinner';
import { QuestionField, SubmittedField } from '@/components/startup/surveyFields';
import { useMySurveyResponse, useSubmitSurvey, useSurveyQuestions } from '@/hooks/useSatisfaction';
import { validateSurvey } from '@/lib/satisfaction';
import type { SurveyAnswerRow, SurveyDraft } from '@/types/satisfaction';

/**
 * 행사 만족도 조사 패널(동적 문항). 스타트업 전용(전문가 응답 기능은 제거됨).
 * 출처: docs/survey_customization_ideation.md §4.
 * 행사 FINISHED 단계에서 노출. 제출 전 = 문항 폼, 제출 후 = 읽기 전용 요약(행사당 1회·수정 불가).
 */
export function SatisfactionPanel({ eventId }: { eventId: string }) {
  const questionsQ = useSurveyQuestions(eventId, 'STARTUP');
  const responseQ = useMySurveyResponse(eventId);
  const submitM = useSubmitSurvey(eventId);

  const [draft, setDraft] = useState<SurveyDraft>({});
  const [formError, setFormError] = useState<string | null>(null);

  const questions = useMemo(() => questionsQ.data ?? [], [questionsQ.data]);
  const response = responseQ.data ?? null;
  const submitError = submitM.isError ? (submitM.error as Error).message : null;

  const answerByQ = useMemo(() => {
    const m = new Map<string, SurveyAnswerRow>();
    (response?.answers ?? []).forEach((a) => m.set(a.question_id, a));
    return m;
  }, [response]);

  const heading = <h2 className="text-base font-bold text-neutral-base">행사 만족도 조사</h2>;

  if (questionsQ.isLoading || responseQ.isLoading) {
    return (
      <Card className="flex items-center justify-center p-6">
        <Spinner className="h-5 w-5" />
      </Card>
    );
  }

  if (questionsQ.isError) {
    return (
      <Card className="flex flex-col gap-3 p-5">
        {heading}
        <Alert tone="error">설문 문항을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
      </Card>
    );
  }

  // 제출 완료 → 읽기 전용 요약
  if (response) {
    return (
      <Card className="flex flex-col gap-4 p-5">
        {heading}
        <Alert tone="success">
          만족도 조사를 제출해 주셔서 감사합니다. 제출한 응답은 수정할 수 없습니다.
        </Alert>
        {questions.map((q) => (
          <SubmittedField key={q.id} q={q} answer={answerByQ.get(q.id)} />
        ))}
      </Card>
    );
  }

  if (questions.length === 0) {
    return (
      <Card className="flex flex-col gap-3 p-5">
        {heading}
        <p className="text-sm text-neutral-base/60">등록된 설문 문항이 없습니다.</p>
      </Card>
    );
  }

  const handleSubmit = () => {
    setFormError(null);
    const result = validateSurvey(questions, draft);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    submitM.mutate(result.payload);
  };

  return (
    <Card className="flex flex-col gap-4 p-5">
      {heading}
      <p className="text-sm text-neutral-base/70">
        각 문항에 응답해 주세요. 제출 후에는 수정할 수 없습니다.
      </p>

      {questions.map((q) => (
        <QuestionField
          key={q.id}
          q={q}
          draft={draft}
          onChange={(next) => setDraft((prev) => ({ ...prev, [q.id]: next }))}
        />
      ))}

      {(formError || submitError) && <Alert tone="error">{formError ?? submitError}</Alert>}

      <div className="flex justify-end">
        <Button onClick={handleSubmit} loading={submitM.isPending}>
          만족도 제출
        </Button>
      </div>
    </Card>
  );
}
