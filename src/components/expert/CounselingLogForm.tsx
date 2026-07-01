import { useEffect, useRef, useState } from 'react';
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
  useReopenCounselingLog,
  useSaveCounselingDraft,
  useSubmitCounselingLog,
} from '@/hooks/useExpertPortal';
import { toast } from '@/stores/toastStore';
import type { CounselingAnswerValue, CounselingDraft } from '@/lib/counseling';
import type { CounselingQuestion } from '@/types/counselingLog';
import type { MatchingSlotRow } from '@/types/eventDetail';

/** 입력을 멈춘 뒤 자동 임시저장까지의 대기(ms). */
const AUTOSAVE_DEBOUNCE_MS = 5000;

/** 1~5 평점 선택(컴팩트 버튼, 라디오 그룹). */
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
            className={`flex h-9 w-11 shrink-0 items-center justify-center rounded-lg border text-sm font-bold transition-colors ${
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
      onChange(
        selections.includes(opt) ? selections.filter((s) => s !== opt) : [...selections, opt],
      );
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
          className="h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
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

/** 자동저장 상태 표시. */
type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

/**
 * 디지털 상담일지 작성 폼 (Split View 우측 패널 · docs/expert_dashboard_split_view_ideation.md §3③).
 * CounselingLogModal 의 본문을 인라인화한 자립형 폼. 행사별 동적 문항(RATING/객관식/주관식)과
 * 후속 연계·공개 여부 메타 필드를 직접 관리하고, 임시저장(자동/수동)·최종 제출 RPC 를 호출한다.
 *
 * 자동 임시저장(§3③): 입력을 멈춘 지 5초가 지나거나(디바운스) 포커스가 폼 밖으로 나갈 때
 * 백그라운드로 save_counseling_log_draft_v2 를 호출한다. WAITING/IN_PROGRESS 세션에서만 동작.
 */
export function CounselingLogForm({
  slot,
  eventId,
  onSubmitted,
  onSaved,
}: {
  slot: MatchingSlotRow;
  eventId: string;
  /** 최종 제출 성공 콜백(워크스페이스에서 다음 액션 처리). */
  onSubmitted?: () => void;
  /** 수동 임시저장 성공 콜백 — 저장과 동시에 이전 페이지로 복귀시킨다. */
  onSaved?: () => void;
}) {
  const slotId = slot.id;
  const questionsQ = useCounselingLogQuestions(eventId, true);
  const logQ = useCounselingLog(slotId, true);
  const saveM = useSaveCounselingDraft(eventId);
  const submitM = useSubmitCounselingLog(eventId);
  const reopenM = useReopenCounselingLog(eventId);

  const [draft, setDraft] = useState<CounselingDraft>(emptyDraft);
  const [seeded, setSeeded] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });

  const questions = questionsQ.data ?? [];
  const loading = questionsQ.isLoading || logQ.isLoading;

  // 진짜 "제출됨" 여부는 세션 완료로 판정한다(임시저장 행도 submitted_at 기본값이 채워지므로).
  const alreadySubmitted = slot.session_status === 'COMPLETED';
  // 임시저장 RPC 는 대기/진행 세션만 허용 — 자동저장도 동일 조건에서만 동작시킨다.
  const autosaveEnabled =
    slot.session_status === 'WAITING' || slot.session_status === 'IN_PROGRESS';

  // 더티 추적 + 디바운스 타이머. 슬롯이 바뀌면 시드를 다시 한다.
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 슬롯 전환 시 시드 초기화.
  useEffect(() => {
    setSeeded(false);
    setFormError(null);
    setSaveState({ kind: 'idle' });
    dirtyRef.current = false;
  }, [slotId]);

  // 문항·기존 로그 조회가 끝나면 폼을 1회 시드한다.
  useEffect(() => {
    if (seeded || loading) return;
    setDraft(draftFromLog(questionsQ.data ?? [], logQ.data?.log ?? null, logQ.data?.answers ?? []));
    setSeeded(true);
  }, [seeded, loading, questionsQ.data, logQ.data]);

  const runAutosave = () => {
    if (!autosaveEnabled || !dirtyRef.current || saveM.isPending) return;
    dirtyRef.current = false;
    setSaveState({ kind: 'saving' });
    saveM.mutate(
      { slotId, questions, draft },
      {
        onSuccess: () => setSaveState({ kind: 'saved' }),
        onError: (e) => setSaveState({ kind: 'error', message: (e as Error).message }),
      },
    );
  };

  // 디바운스 자동저장: draft 가 바뀔 때마다 타이머를 재설정한다.
  useEffect(() => {
    if (!seeded || !autosaveEnabled || !dirtyRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(runAutosave, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // draft 변경마다 타이머 재설정. runAutosave 는 최신 클로저로 재생성된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, seeded, autosaveEnabled]);

  const markDirty = () => {
    dirtyRef.current = true;
    if (saveState.kind !== 'saving') setSaveState({ kind: 'idle' });
  };

  const setAnswer = (qid: string, next: CounselingAnswerValue) => {
    markDirty();
    setDraft((d) => ({ ...d, answers: { ...d.answers, [qid]: next } }));
  };

  const handleManualSave = () => {
    setFormError(null);
    dirtyRef.current = false;
    setSaveState({ kind: 'saving' });
    saveM.mutate(
      { slotId, questions, draft },
      {
        onSuccess: () => {
          setSaveState({ kind: 'saved' });
          toast.success('임시저장했습니다.');
          // 저장과 동시에 이전 페이지(전체 일정)로 복귀.
          onSaved?.();
        },
        onError: (e) => {
          setSaveState({ kind: 'error', message: (e as Error).message });
          toast.error('임시저장하지 못했습니다. 다시 시도해 주세요.');
        },
      },
    );
  };

  const handleSubmit = () => {
    setFormError(null);
    const result = validateSubmit(questions, draft);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    submitM.mutate(
      { slotId, questions, draft },
      {
        onSuccess: () => {
          toast.success('상담일지를 제출했습니다.');
          onSubmitted?.();
        },
        onError: (e) =>
          toast.error('상담일지를 제출하지 못했습니다. 필수 항목과 네트워크 상태를 확인해 주세요.', {
            description: (e as Error).message,
          }),
      },
    );
  };

  const handleReopen = () => {
    setFormError(null);
    reopenM.mutate(slotId, {
      onSuccess: () => toast.success('제출을 취소했습니다. 다시 편집할 수 있습니다.'),
      onError: (e) =>
        toast.error('제출을 취소하지 못했습니다. 다시 시도해 주세요.', {
          description: (e as Error).message,
        }),
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    // 포커스가 폼 밖으로 나갈 때(다른 입력 창 이동 등) 즉시 자동저장(§3③).
    <div className="flex h-full flex-col" onBlur={runAutosave}>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-5">
          {alreadySubmitted && (
            <Alert tone="info">
              제출 완료된 상담일지입니다. 내용을 수정하려면 아래 "제출 취소"로 다시 진행 중 상태로
              되돌린 뒤 편집해 주세요. (행사 종료 전까지 가능)
            </Alert>
          )}

          {questionsQ.isError && (
            <Alert tone="error">
              상담일지 문항을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.
            </Alert>
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
                onChange={(next) => {
                  markDirty();
                  setDraft((d) => ({ ...d, followUpRequired: next }));
                }}
              />
            </div>
            {draft.followUpRequired && (
              <>
                <textarea
                  rows={2}
                  maxLength={FOLLOWUP_MEMO_MAX}
                  value={draft.followUpMemo}
                  onChange={(e) => {
                    markDirty();
                    setDraft((d) => ({ ...d, followUpMemo: e.target.value }));
                  }}
                  placeholder="추가 매칭 필요 사유·메모"
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-base text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
                <span className="text-right text-xs text-neutral-base/50">
                  {draft.followUpMemo.length} / {FOLLOWUP_MEMO_MAX}
                </span>
              </>
            )}
          </section>

          {formError && <Alert tone="error">{formError}</Alert>}
        </div>
      </div>

      {/* 하단 고정 액션 바: 자동저장 상태 + 임시저장/제출 */}
      <div className="flex items-center justify-between gap-2 border-t border-border bg-surface px-4 py-3">
        <AutosaveIndicator state={saveState} enabled={autosaveEnabled} />
        <div className="flex gap-2">
          {alreadySubmitted ? (
            // 제출 완료(COMPLETED) 상태: 제출 취소로 다시 진행 중(IN_PROGRESS)으로 되돌린다.
            <Button
              variant="outline"
              size="md"
              onClick={handleReopen}
              loading={reopenM.isPending}
            >
              제출 취소
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="md"
                onClick={handleManualSave}
                loading={saveM.isPending}
                disabled={!autosaveEnabled}
              >
                임시저장
              </Button>
              <Button size="md" onClick={handleSubmit} loading={submitM.isPending}>
                상담 완료 및 제출
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** 자동저장 상태 텍스트(좌하단). */
function AutosaveIndicator({ state, enabled }: { state: SaveState; enabled: boolean }) {
  if (!enabled) {
    return (
      <span className="text-xs text-neutral-base/45">대기/진행 세션에서만 자동저장됩니다.</span>
    );
  }
  switch (state.kind) {
    case 'saving':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-neutral-base/60">
          <Spinner className="h-3 w-3" /> 자동 저장 중…
        </span>
      );
    case 'saved':
      return <span className="text-xs text-success">✓ 저장됨</span>;
    case 'error':
      return <span className="text-xs text-brand">자동저장 실패: {state.message}</span>;
    default:
      return <span className="text-xs text-neutral-base/45">입력을 멈추면 자동 저장됩니다</span>;
  }
}
