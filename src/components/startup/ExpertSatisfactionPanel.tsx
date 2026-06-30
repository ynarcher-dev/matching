import { useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { Spinner } from '@/components/common/Spinner';
import { Badge } from '@/components/common/Badge';
import { QuestionField, SubmittedField } from '@/components/startup/surveyFields';
import {
  useConsultedExperts,
  useMyExpertSurveyResponses,
  useSubmitExpertSurvey,
  useSurveyQuestions,
} from '@/hooks/useSatisfaction';
import { validateSurvey } from '@/lib/satisfaction';
import { formatRange } from '@/lib/datetime';
import type {
  ConsultedExpertSlot,
  MyExpertSurveyResponse,
  SurveyAnswerRow,
  SurveyDraft,
  SurveyQuestion,
} from '@/types/satisfaction';

/** 상담 1건(슬롯)에 대한 응답 카드 — 미응답이면 폼, 응답 완료면 읽기 전용 요약. */
function SlotCard({
  slot,
  questions,
  response,
  timezone,
  open,
  onToggle,
  onSubmit,
  submitting,
  submitError,
}: {
  slot: ConsultedExpertSlot;
  questions: SurveyQuestion[];
  response: MyExpertSurveyResponse | undefined;
  timezone: string;
  open: boolean;
  onToggle: () => void;
  onSubmit: (draft: SurveyDraft, onDone: () => void) => void;
  submitting: boolean;
  submitError: string | null;
}) {
  const [draft, setDraft] = useState<SurveyDraft>({});
  const [formError, setFormError] = useState<string | null>(null);

  const answerByQ = useMemo(() => {
    const m = new Map<string, SurveyAnswerRow>();
    (response?.answers ?? []).forEach((a) => m.set(a.question_id, a));
    return m;
  }, [response]);

  const done = Boolean(response) || slot.responded;
  const org = slot.expert_organization?.trim();

  const handleSubmit = () => {
    setFormError(null);
    const result = validateSurvey(questions, draft);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    onSubmit(draft, () => setDraft({}));
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-bold text-neutral-base">
            {slot.expert_name}
            {org && <span className="font-normal text-neutral-base/60"> · {org}</span>}
          </span>
          <span className="text-xs text-neutral-base/60">
            {formatRange(slot.start_time, slot.end_time, timezone)}
          </span>
        </div>
        {done ? (
          <Badge tone="brand" className="shrink-0">
            응답 완료
          </Badge>
        ) : (
          <Button variant="outline" onClick={onToggle}>
            {open ? '접기' : '평가하기'}
          </Button>
        )}
      </div>

      {/* 응답 완료 → 읽기 전용 요약 */}
      {done && response && (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          {questions.map((q) => (
            <SubmittedField key={q.id} q={q} answer={answerByQ.get(q.id)} />
          ))}
        </div>
      )}

      {/* 미응답 + 폼 펼침 */}
      {!done && open && (
        <div className="flex flex-col gap-4 border-t border-border pt-3">
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
            <Button onClick={handleSubmit} loading={submitting}>
              제출
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 전문가 만족도 조사 패널(스타트업, 8-G).
 * 행사 FINISHED 단계 + 정책(EXPERT_ONLY/BOTH)에서 노출. 상담한 전문가/세션(슬롯)마다 1회 응답.
 * 출처: docs/functional_followup_plan.md T6 — "스타트업이 실제 상담한 전문가/세션별로 응답".
 */
export function ExpertSatisfactionPanel({
  eventId,
  timezone,
}: {
  eventId: string;
  timezone: string;
}) {
  const questionsQ = useSurveyQuestions(eventId, 'STARTUP', 'EXPERT');
  const slotsQ = useConsultedExperts(eventId);
  const responsesQ = useMyExpertSurveyResponses(eventId);
  const submitM = useSubmitExpertSurvey(eventId);

  const [openSlot, setOpenSlot] = useState<string | null>(null);

  const questions = useMemo(() => questionsQ.data ?? [], [questionsQ.data]);
  const slots = useMemo(() => slotsQ.data ?? [], [slotsQ.data]);
  const responseBySlot = useMemo(() => {
    const m = new Map<string, MyExpertSurveyResponse>();
    (responsesQ.data ?? []).forEach((r) => m.set(r.slot_id, r));
    return m;
  }, [responsesQ.data]);

  const submitError =
    submitM.isError && submitM.variables?.slotId === openSlot
      ? (submitM.error as Error).message
      : null;

  const heading = <h2 className="text-base font-bold text-neutral-base">전문가 만족도 조사</h2>;

  if (questionsQ.isLoading || slotsQ.isLoading || responsesQ.isLoading) {
    return (
      <Card className="flex items-center justify-center p-6">
        <Spinner className="h-5 w-5" />
      </Card>
    );
  }

  if (questionsQ.isError || slotsQ.isError) {
    return (
      <Card className="flex flex-col gap-3 p-5">
        {heading}
        <Alert tone="error">전문가 만족도 정보를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
      </Card>
    );
  }

  if (questions.length === 0) {
    return (
      <Card className="flex flex-col gap-3 p-5">
        {heading}
        <p className="text-sm text-neutral-base/60">등록된 전문가 만족도 문항이 없습니다.</p>
      </Card>
    );
  }

  if (slots.length === 0) {
    return (
      <Card className="flex flex-col gap-3 p-5">
        {heading}
        <p className="text-sm text-neutral-base/60">
          상담한 전문가가 없어 응답 대상이 없습니다. (취소·노쇼 상담은 제외됩니다.)
        </p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      {heading}
      <p className="text-sm text-neutral-base/70">
        상담한 전문가별로 만족도를 남겨 주세요. 각 상담은 1회만 응답할 수 있으며 제출 후 수정할 수 없습니다.
      </p>

      <div className="flex flex-col gap-2.5">
        {slots.map((slot) => (
          <SlotCard
            key={slot.slot_id}
            slot={slot}
            questions={questions}
            response={responseBySlot.get(slot.slot_id)}
            timezone={timezone}
            open={openSlot === slot.slot_id}
            onToggle={() => setOpenSlot((prev) => (prev === slot.slot_id ? null : slot.slot_id))}
            submitting={submitM.isPending && submitM.variables?.slotId === slot.slot_id}
            submitError={openSlot === slot.slot_id ? submitError : null}
            onSubmit={(draft, onDone) => {
              const result = validateSurvey(questions, draft);
              if (!result.ok) return;
              submitM.mutate(
                { slotId: slot.slot_id, answers: result.payload },
                {
                  onSuccess: () => {
                    onDone();
                    setOpenSlot(null);
                  },
                },
              );
            }}
          />
        ))}
      </div>
    </Card>
  );
}
