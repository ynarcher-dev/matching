import { useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { Spinner } from '@/components/common/Spinner';
import { useMySurveyResponse, useSubmitSurvey, useSurveyQuestions } from '@/hooks/useSatisfaction';
import { RATING_SCALE, textMaxFor, validateSurvey } from '@/lib/satisfaction';
import type {
  SurveyAnswerRow,
  SurveyDraft,
  SurveyQuestion,
  SurveyTargetRole,
} from '@/types/satisfaction';

/** 1~5 평점 세그먼트(라디오 그룹). readOnly 면 선택 결과만 표기. */
function RatingInput({
  label,
  value,
  onChange,
  readOnly = false,
}: {
  label: string;
  value: number | null;
  onChange?: (value: number) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label={label}>
      {RATING_SCALE.map((n) => {
        const active = value === n;
        const base =
          'flex h-10 w-10 items-center justify-center rounded-lg border text-sm font-bold transition-colors';
        const tone = active
          ? 'border-brand bg-brand text-white'
          : 'border-border bg-white text-neutral-base';
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={readOnly}
            onClick={readOnly ? undefined : () => onChange?.(n)}
            className={`${base} ${tone} ${readOnly ? 'cursor-default' : 'hover:border-brand'}`}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

/** 객관식 선택 카드(단일=radio / 복수=checkbox). */
function ChoiceInput({
  options,
  selections,
  multiple,
  onChange,
  readOnly = false,
}: {
  options: string[];
  selections: string[];
  multiple: boolean;
  onChange?: (next: string[]) => void;
  readOnly?: boolean;
}) {
  const toggle = (opt: string) => {
    if (readOnly || !onChange) return;
    if (multiple) {
      onChange(selections.includes(opt) ? selections.filter((s) => s !== opt) : [...selections, opt]);
    } else {
      onChange([opt]);
    }
  };
  return (
    <div className="flex flex-col gap-1.5" role={multiple ? 'group' : 'radiogroup'}>
      {options.map((opt) => {
        const active = selections.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            role={multiple ? 'checkbox' : 'radio'}
            aria-checked={active}
            disabled={readOnly}
            onClick={() => toggle(opt)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
              active
                ? 'border-brand bg-brand/5 font-semibold text-neutral-base'
                : 'border-border bg-white text-neutral-base'
            } ${readOnly ? 'cursor-default' : 'hover:border-brand'}`}
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center border ${
                multiple ? 'rounded' : 'rounded-full'
              } ${active ? 'border-brand bg-brand text-white' : 'border-border'}`}
            >
              {active && <span className="text-[10px] leading-none">✓</span>}
            </span>
            {opt}
          </button>
        );
      })}
    </div>
  );
}

/** 단일 문항 + 입력 위젯(폼 모드). */
function QuestionField({
  q,
  draft,
  onChange,
}: {
  q: SurveyQuestion;
  draft: SurveyDraft;
  onChange: (next: SurveyDraft[string]) => void;
}) {
  const v = draft[q.id] ?? {};
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-neutral-base">
        {q.title}
        {q.is_required && <span className="ml-0.5 text-brand">*</span>}
      </span>
      {q.description && <span className="text-xs text-neutral-base/60">{q.description}</span>}

      {q.question_type === 'RATING' && (
        <RatingInput
          label={q.title}
          value={v.rating ?? null}
          onChange={(rating) => onChange({ ...v, rating })}
        />
      )}

      {(q.question_type === 'SINGLE_CHOICE' || q.question_type === 'MULTIPLE_CHOICE') && (
        <ChoiceInput
          options={q.options ?? []}
          selections={v.selections ?? []}
          multiple={q.question_type === 'MULTIPLE_CHOICE'}
          onChange={(selections) => onChange({ ...v, selections })}
        />
      )}

      {(q.question_type === 'SHORT_ANSWER' || q.question_type === 'LONG_ANSWER') &&
        (q.question_type === 'SHORT_ANSWER' ? (
          <input
            type="text"
            maxLength={textMaxFor(q.question_type)}
            value={v.text ?? ''}
            onChange={(e) => onChange({ ...v, text: e.target.value })}
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-base text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        ) : (
          <>
            <textarea
              rows={4}
              maxLength={textMaxFor(q.question_type)}
              value={v.text ?? ''}
              onChange={(e) => onChange({ ...v, text: e.target.value })}
              placeholder="자유롭게 의견을 남겨 주세요."
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-base text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
            <span className="text-right text-xs text-neutral-base/50">
              {(v.text ?? '').length} / {textMaxFor(q.question_type)}
            </span>
          </>
        ))}
    </div>
  );
}

/** 제출 완료된 문항+답변(읽기 전용). */
function SubmittedField({ q, answer }: { q: SurveyQuestion; answer?: SurveyAnswerRow }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-neutral-base">{q.title}</span>
      {q.question_type === 'RATING' && <RatingInput label={q.title} value={answer?.answer_rating ?? null} readOnly />}
      {(q.question_type === 'SINGLE_CHOICE' || q.question_type === 'MULTIPLE_CHOICE') && (
        <ChoiceInput
          options={q.options ?? []}
          selections={answer?.answer_selections ?? []}
          multiple={q.question_type === 'MULTIPLE_CHOICE'}
          readOnly
        />
      )}
      {(q.question_type === 'SHORT_ANSWER' || q.question_type === 'LONG_ANSWER') && (
        <p className="whitespace-pre-wrap rounded-lg border border-border bg-surface px-3 py-2 text-sm text-neutral-base/90">
          {answer?.answer_text?.trim() ? answer.answer_text : '응답 없음'}
        </p>
      )}
    </div>
  );
}

/**
 * 행사 만족도 조사 패널(동적 문항).
 * 출처: docs/survey_customization_ideation.md §4.
 * 행사 FINISHED 단계에서 노출. 제출 전 = 문항 폼, 제출 후 = 읽기 전용 요약(행사당 1회·수정 불가).
 */
export function SatisfactionPanel({
  eventId,
  role = 'STARTUP',
}: {
  eventId: string;
  role?: SurveyTargetRole;
}) {
  const questionsQ = useSurveyQuestions(eventId, role);
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
