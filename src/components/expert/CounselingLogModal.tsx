import { useEffect, useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { Spinner } from '@/components/common/Spinner';
import { Toggle } from '@/components/common/Toggle';
import {
  FOLLOWUP_MEMO_MAX,
  RATING_SCALE,
  draftFromLog,
  emptyDraft,
  textMaxFor,
  validateSubmit,
} from '@/lib/counseling';
import {
  useCounselingLog,
  useCounselingLogQuestions,
  useSaveCounselingDraft,
  useSubmitCounselingLog,
} from '@/hooks/useExpertPortal';
import type { CounselingAnswerValue, CounselingDraft } from '@/lib/counseling';
import type { CounselingQuestion } from '@/types/counselingLog';
import type { MatchingSlotRow } from '@/types/eventDetail';

/** 1~5 평점 선택(큰 터치 영역, 라디오 그룹). */
function RatingField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label={label}>
      {RATING_SCALE.map((n) => {
        const active = value === n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(n)}
            className={`flex h-11 flex-1 items-center justify-center rounded-lg border text-base font-bold transition-colors ${
              active
                ? 'border-brand bg-brand text-white'
                : 'border-border bg-white text-neutral-base hover:border-brand'
            }`}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

/** 객관식 선택(단일=radio / 복수=checkbox). */
function ChoiceField({
  options,
  selections,
  multiple,
  onChange,
}: {
  options: string[];
  selections: string[];
  multiple: boolean;
  onChange: (next: string[]) => void;
}) {
  const toggle = (opt: string) => {
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
            onClick={() => toggle(opt)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
              active
                ? 'border-brand bg-brand/5 font-semibold text-neutral-base'
                : 'border-border bg-white text-neutral-base hover:border-brand'
            }`}
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

/** 단일 문항 + 입력 위젯. */
function QuestionField({
  q,
  value,
  onChange,
}: {
  q: CounselingQuestion;
  value: CounselingAnswerValue;
  onChange: (next: CounselingAnswerValue) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col">
        <span className="text-sm font-semibold text-neutral-base">
          {q.title}
          {q.is_required && <span className="ml-0.5 text-brand">*</span>}
        </span>
        {q.description && <span className="text-xs text-neutral-base/60">{q.description}</span>}
      </div>

      {q.question_type === 'RATING' && (
        <RatingField
          label={q.title}
          value={value.rating ?? null}
          onChange={(rating) => onChange({ ...value, rating })}
        />
      )}

      {(q.question_type === 'SINGLE_CHOICE' || q.question_type === 'MULTIPLE_CHOICE') && (
        <ChoiceField
          options={q.options ?? []}
          selections={value.selections ?? []}
          multiple={q.question_type === 'MULTIPLE_CHOICE'}
          onChange={(selections) => onChange({ ...value, selections })}
        />
      )}

      {q.question_type === 'SHORT_ANSWER' && (
        <input
          type="text"
          maxLength={textMaxFor(q.question_type)}
          value={value.text ?? ''}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-base text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      )}

      {q.question_type === 'LONG_ANSWER' && (
        <>
          <textarea
            rows={5}
            maxLength={textMaxFor(q.question_type)}
            value={value.text ?? ''}
            onChange={(e) => onChange({ ...value, text: e.target.value })}
            placeholder="스타트업의 애로사항과 상담 코칭 요약을 기록해 주세요."
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-base text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
          <span className="text-right text-xs text-neutral-base/50">
            {(value.text ?? '').length} / {textMaxFor(q.question_type)}
          </span>
        </>
      )}
    </div>
  );
}

/**
 * 디지털 상담일지 작성 모달 (docs/counseling_log_customization.md §7).
 * 행사별 동적 문항(RATING/객관식/주관식) + 후속 연계 + 공개 여부 메타 필드.
 * 임시저장(save_counseling_log_draft_v2)과 최종 제출(submit_counseling_log_v2)을 분리한다.
 */
export function CounselingLogModal({
  open,
  slot,
  startupName,
  eventId,
  onClose,
}: {
  open: boolean;
  slot: MatchingSlotRow | null;
  startupName: string;
  eventId: string;
  onClose: () => void;
}) {
  const slotId = slot?.id ?? '';
  const questionsQ = useCounselingLogQuestions(eventId, open);
  const logQ = useCounselingLog(slotId, open);
  const saveM = useSaveCounselingDraft(eventId);
  const submitM = useSubmitCounselingLog(eventId);

  const [draft, setDraft] = useState<CounselingDraft>(emptyDraft);
  const [seeded, setSeeded] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const questions = questionsQ.data ?? [];
  const loading = questionsQ.isLoading || logQ.isLoading;

  // 모달이 열리고 문항·기존 로그 조회가 끝나면 폼을 1회 시드한다.
  useEffect(() => {
    if (!open) {
      setSeeded(false);
      setFormError(null);
      return;
    }
    if (seeded || loading) return;
    setDraft(
      draftFromLog(questionsQ.data ?? [], logQ.data?.log ?? null, logQ.data?.answers ?? []),
    );
    setSeeded(true);
  }, [open, seeded, loading, questionsQ.data, logQ.data]);

  if (!open || !slot) return null;

  // 진짜 "제출됨" 여부는 세션 완료로 판정한다(임시저장 행도 submitted_at 기본값이 채워지므로).
  const alreadySubmitted = slot.session_status === 'COMPLETED';
  const setAnswer = (qid: string, next: CounselingAnswerValue) =>
    setDraft((d) => ({ ...d, answers: { ...d.answers, [qid]: next } }));

  const mutationError =
    (saveM.isError && (saveM.error as Error).message) ||
    (submitM.isError && (submitM.error as Error).message) ||
    null;

  const handleSave = () => {
    setFormError(null);
    saveM.mutate({ slotId, questions, draft });
  };

  const handleSubmit = () => {
    setFormError(null);
    const result = validateSubmit(questions, draft);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    submitM.mutate({ slotId, questions, draft }, { onSuccess: onClose });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`상담일지 · ${startupName}`}
      footer={
        <>
          <Button variant="outline" onClick={handleSave} loading={saveM.isPending}>
            임시저장
          </Button>
          <Button onClick={handleSubmit} loading={submitM.isPending}>
            상담 완료 및 제출
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {alreadySubmitted && (
            <Alert tone="info">
              이미 제출된 상담일지입니다. 수정 후 다시 제출하면 변경 이력이 감사 로그에 기록됩니다.
              (행사 종료 전까지 수정 가능)
            </Alert>
          )}

          {questionsQ.isError && (
            <Alert tone="error">상담일지 문항을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
          )}

          {/* 동적 평가 문항 */}
          {questions.length === 0 ? (
            <p className="text-sm text-neutral-base/60">등록된 상담일지 문항이 없습니다.</p>
          ) : (
            <section className="flex flex-col gap-4">
              {questions.map((q) => (
                <QuestionField
                  key={q.id}
                  q={q}
                  value={draft.answers[q.id] ?? {}}
                  onChange={(next) => setAnswer(q.id, next)}
                />
              ))}
            </section>
          )}

          {/* 후속 연계 (메타 필드) */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-neutral-base">후속 연계 요청</span>
              <Toggle
                label="후속 연계 요청"
                checked={draft.followUpRequired}
                onChange={(next) => setDraft((d) => ({ ...d, followUpRequired: next }))}
              />
            </div>
            {draft.followUpRequired && (
              <>
                <textarea
                  rows={2}
                  maxLength={FOLLOWUP_MEMO_MAX}
                  value={draft.followUpMemo}
                  onChange={(e) => setDraft((d) => ({ ...d, followUpMemo: e.target.value }))}
                  placeholder="추가 매칭 필요 사유·메모"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-base text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
                <span className="text-right text-xs text-neutral-base/50">
                  {draft.followUpMemo.length} / {FOLLOWUP_MEMO_MAX}
                </span>
              </>
            )}
          </section>

          {/* 공개 여부 (메타 필드) */}
          <section className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2.5">
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-neutral-base">상담 의견 스타트업 공개</span>
              <span className="text-xs text-neutral-base/60">
                점수·구조화 답변은 항상 비공개입니다. 공개 허용 시 텍스트 상담 의견만 스타트업에 노출됩니다.
              </span>
            </div>
            <Toggle
              label="상담 의견 스타트업 공개"
              checked={draft.isPublic}
              onChange={(next) => setDraft((d) => ({ ...d, isPublic: next }))}
            />
          </section>

          {(formError || mutationError) && <Alert tone="error">{formError ?? mutationError}</Alert>}
        </div>
      )}
    </Modal>
  );
}
