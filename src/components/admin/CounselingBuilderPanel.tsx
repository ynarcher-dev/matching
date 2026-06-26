import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { Spinner } from '@/components/common/Spinner';
import { Modal } from '@/components/common/Modal';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { TextField } from '@/components/common/TextField';
import { SelectField } from '@/components/common/SelectField';
import { Toggle } from '@/components/common/Toggle';
import {
  useAddCounselingTemplate,
  useCreateCounselingQuestion,
  useDeleteCounselingQuestion,
  useEventCounselingAnswerCount,
  useEventCounselingQuestions,
  useSwapCounselingQuestionOrder,
  useUpdateCounselingQuestion,
} from '@/hooks/useCounselingBuilder';
import {
  defaultTemplate,
  editLockReason,
  needsOptions,
  nextOrderNo,
  QUESTION_TYPE_LABEL,
  QUESTION_TYPE_OPTIONS,
} from '@/lib/counselingBuilder';
import { counselingQuestionFormSchema } from '@/schemas/counselingBuilderSchemas';
import type {
  CounselingQuestion,
  CounselingQuestionInput,
  CounselingQuestionType,
} from '@/types/counselingLog';
import type { EventStatus } from '@/types/event';

/** 문항 편집 모달 — 신규/수정 공용. 저장 시 검증 후 CounselingQuestionInput 을 돌려준다. */
function QuestionEditorModal({
  open,
  initial,
  orderNo,
  onClose,
  onSave,
  loading,
  error,
}: {
  open: boolean;
  initial: CounselingQuestion | null;
  orderNo: number;
  onClose: () => void;
  onSave: (input: CounselingQuestionInput) => void;
  loading: boolean;
  error: string | null;
}) {
  const [type, setType] = useState<CounselingQuestionType>('RATING');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [required, setRequired] = useState(true);
  const [options, setOptions] = useState<string[]>(['', '']);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setType(initial?.question_type ?? 'RATING');
    setTitle(initial?.title ?? '');
    setDescription(initial?.description ?? '');
    setRequired(initial?.is_required ?? true);
    setOptions(initial?.options && initial.options.length > 0 ? initial.options : ['', '']);
    setFormError(null);
  }, [open, initial]);

  const showOptions = needsOptions(type);

  const handleSave = () => {
    setFormError(null);
    const parsed = counselingQuestionFormSchema.safeParse({
      question_type: type,
      title,
      description: description.trim() ? description : undefined,
      is_required: required,
      options,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? '입력값을 확인해 주세요.');
      return;
    }
    onSave({
      question_type: parsed.data.question_type,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      options: showOptions ? parsed.data.options.map((o) => o.trim()).filter(Boolean) : null,
      is_required: parsed.data.is_required,
      order_no: orderNo,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? '문항 수정' : '문항 추가'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            취소
          </Button>
          <Button onClick={handleSave} loading={loading}>
            저장
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {(formError || error) && <Alert tone="error">{formError ?? error}</Alert>}

        <SelectField
          label="문항 유형"
          value={type}
          onChange={(e) => setType(e.target.value as CounselingQuestionType)}
          options={QUESTION_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />

        <TextField
          label="질문 제목"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="예: 기술성, 투자 단계 적합성"
          maxLength={200}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="clog-q-desc" className="text-sm font-semibold text-neutral-base">
            보조 설명 (선택)
          </label>
          <input
            id="clog-q-desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="문항 아래에 표시될 안내 문구"
            maxLength={500}
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-base text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>

        {showOptions && (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-neutral-base">선택지</span>
            {options.map((opt, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={opt}
                  onChange={(e) =>
                    setOptions((prev) => prev.map((o, i) => (i === idx ? e.target.value : o)))
                  }
                  placeholder={`선택지 ${idx + 1}`}
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-base text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
                <button
                  type="button"
                  onClick={() => setOptions((prev) => prev.filter((_, i) => i !== idx))}
                  disabled={options.length <= 1}
                  aria-label={`선택지 ${idx + 1} 삭제`}
                  className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-neutral-base/70 transition-colors hover:bg-surface disabled:opacity-40"
                >
                  −
                </button>
              </div>
            ))}
            <Button variant="outline" onClick={() => setOptions((prev) => [...prev, ''])}>
              + 선택지 추가
            </Button>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-neutral-base">필수 응답</span>
          <Toggle checked={required} onChange={setRequired} label="필수 응답 여부" />
        </div>
      </div>
    </Modal>
  );
}

/** 문항 한 개 카드(목록 행). */
function QuestionCard({
  q,
  index,
  total,
  editable,
  onMove,
  onEdit,
  onDelete,
}: {
  q: CounselingQuestion;
  index: number;
  total: number;
  editable: boolean;
  onMove: (dir: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-col items-center gap-1 pt-0.5">
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={!editable || index === 0}
          aria-label="위로 이동"
          className="rounded border border-border px-1.5 text-xs text-neutral-base/70 transition-colors hover:bg-surface disabled:opacity-30"
        >
          ▲
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={!editable || index === total - 1}
          aria-label="아래로 이동"
          className="rounded border border-border px-1.5 text-xs text-neutral-base/70 transition-colors hover:bg-surface disabled:opacity-30"
        >
          ▼
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-neutral-base/70">
            {QUESTION_TYPE_LABEL[q.question_type]}
          </span>
          {q.is_required && (
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">
              필수
            </span>
          )}
          {q.system_key && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
              기본 항목
            </span>
          )}
        </div>
        <span className="text-sm font-bold text-neutral-base">{q.title}</span>
        {q.description && <span className="text-xs text-neutral-base/60">{q.description}</span>}
        {q.options && q.options.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {q.options.map((o, i) => (
              <span key={i} className="rounded border border-border px-2 py-0.5 text-xs text-neutral-base/80">
                {o}
              </span>
            ))}
          </div>
        )}
      </div>

      {editable && (
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-neutral-base transition-colors hover:bg-surface"
          >
            수정
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-brand transition-colors hover:bg-brand/5"
          >
            삭제
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 상담일지 빌더 패널 (관리자 행사 상세 — 상담일지 설정 탭).
 * 출처: docs/counseling_log_customization.md §6.
 * 전문가가 상담 종료 시 작성할 평가 문항을 행사별로 구성. 답변 발생/진행단계 이후엔 편집 잠금.
 * 후속 연계·공개 여부는 문항이 아니라 상담일지 메타 필드로 유지한다(§6 주석 참고).
 */
export function CounselingBuilderPanel({
  eventId,
  status,
}: {
  eventId: string;
  status: EventStatus;
}) {
  const questionsQ = useEventCounselingQuestions(eventId);
  const countQ = useEventCounselingAnswerCount(eventId);

  const createM = useCreateCounselingQuestion(eventId);
  const updateM = useUpdateCounselingQuestion(eventId);
  const deleteM = useDeleteCounselingQuestion(eventId);
  const swapM = useSwapCounselingQuestionOrder(eventId);
  const templateM = useAddCounselingTemplate(eventId);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CounselingQuestion | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CounselingQuestion | null>(null);

  const questions = useMemo(
    () => (questionsQ.data ?? []).slice().sort((a, b) => a.order_no - b.order_no),
    [questionsQ.data],
  );
  const answerCount = countQ.data ?? 0;
  const lockReason = editLockReason(status, answerCount);
  const editable = lockReason === null;

  const saveError = createM.isError
    ? (createM.error as Error).message
    : updateM.isError
      ? (updateM.error as Error).message
      : null;

  const openNew = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (q: CounselingQuestion) => {
    setEditing(q);
    setEditorOpen(true);
  };
  const closeEditor = () => {
    setEditorOpen(false);
    setEditing(null);
    createM.reset();
    updateM.reset();
  };

  const handleSave = (input: CounselingQuestionInput) => {
    if (editing) {
      updateM.mutate({ id: editing.id, input }, { onSuccess: closeEditor });
    } else {
      createM.mutate(input, { onSuccess: closeEditor });
    }
  };

  const handleMove = (idx: number, dir: -1 | 1) => {
    const target = questions[idx + dir];
    const current = questions[idx];
    if (!target || !current) return;
    swapM.mutate([
      { id: current.id, order_no: current.order_no },
      { id: target.id, order_no: target.order_no },
    ]);
  };

  if (questionsQ.isLoading || countQ.isLoading) {
    return (
      <Card className="flex items-center justify-center p-8">
        <Spinner className="h-5 w-5" />
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-bold text-neutral-base">상담일지 설정</h2>
        <p className="text-sm text-neutral-base/70">
          전문가가 상담 종료 시 작성할 평가 문항을 구성합니다. 후속 연계 요청·공개 여부는 항상 제공되는
          기본 항목입니다.
        </p>
      </div>

      {lockReason && <Alert tone="info">{lockReason}</Alert>}
      {(questionsQ.isError || countQ.isError) && (
        <Alert tone="error">상담일지 문항을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
      )}
      {swapM.isError && <Alert tone="error">순서를 변경하지 못했습니다. 다시 시도해 주세요.</Alert>}
      {deleteM.isError && <Alert tone="error">{(deleteM.error as Error).message}</Alert>}
      {templateM.isError && <Alert tone="error">{(templateM.error as Error).message}</Alert>}

      {questions.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-3 py-8">
          <p className="text-sm text-neutral-base/60">등록된 문항이 없습니다.</p>
          {editable && (
            <Button
              variant="outline"
              loading={templateM.isPending}
              onClick={() => templateM.mutate(defaultTemplate())}
            >
              기본 문항 불러오기
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {questions.map((q, idx) => (
            <QuestionCard
              key={q.id}
              q={q}
              index={idx}
              total={questions.length}
              editable={editable && !swapM.isPending}
              onMove={(dir) => handleMove(idx, dir)}
              onEdit={() => openEdit(q)}
              onDelete={() => setDeleteTarget(q)}
            />
          ))}
        </div>
      )}

      {editable && (
        <div className="flex justify-end">
          <Button onClick={openNew}>+ 문항 추가</Button>
        </div>
      )}

      <QuestionEditorModal
        key={editing?.id ?? 'new'}
        open={editorOpen}
        initial={editing}
        orderNo={editing ? editing.order_no : nextOrderNo(questions)}
        onClose={closeEditor}
        onSave={handleSave}
        loading={createM.isPending || updateM.isPending}
        error={saveError}
      />

      <ConfirmModal
        open={Boolean(deleteTarget)}
        onClose={() => {
          setDeleteTarget(null);
          deleteM.reset();
        }}
        title="문항 삭제"
        confirmLabel="삭제"
        loading={deleteM.isPending}
        error={deleteM.isError ? (deleteM.error as Error).message : null}
        message={
          deleteTarget ? (
            <>
              <span className="font-bold">{deleteTarget.title}</span> 문항을 삭제하시겠습니까?
              {deleteTarget.system_key && (
                <span className="mt-1 block text-xs text-brand">
                  기본 항목을 삭제하면 해당 점수/의견이 기존 화면·공개 코멘트에 더 이상 동기화되지 않습니다.
                </span>
              )}
            </>
          ) : null
        }
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteM.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
        }}
      />
    </Card>
  );
}
