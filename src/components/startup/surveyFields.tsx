import { RATING_SCALE, textMaxFor } from '@/lib/satisfaction';
import type { SurveyAnswerRow, SurveyDraft, SurveyQuestion } from '@/types/satisfaction';

/**
 * 만족도 설문 입력 위젯 모음 (행사 만족도·전문가 만족도 공용, 8-G).
 * SatisfactionPanel(행사)·ExpertSatisfactionPanel(전문가)이 동일한 폼 UX 를 쓰도록 분리.
 */

/** 1~5 평점 세그먼트(라디오 그룹). readOnly 면 선택 결과만 표기. */
export function RatingInput({
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
export function ChoiceInput({
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
export function QuestionField({
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
export function SubmittedField({ q, answer }: { q: SurveyQuestion; answer?: SurveyAnswerRow }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-neutral-base">{q.title}</span>
      {q.question_type === 'RATING' && (
        <RatingInput label={q.title} value={answer?.answer_rating ?? null} readOnly />
      )}
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
