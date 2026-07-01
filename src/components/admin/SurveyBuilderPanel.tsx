import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { SectionActionButton } from '@/components/common/ActionButton';
import { Spinner } from '@/components/common/Spinner';
import { Modal } from '@/components/common/Modal';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { TextField } from '@/components/common/TextField';
import { SelectField } from '@/components/common/SelectField';
import { Toggle } from '@/components/common/Toggle';
import {
  useAddTemplateQuestions,
  useCreateQuestion,
  useDeleteQuestion,
  useEventSurveyQuestions,
  useEventSurveyResponseCount,
  useReorderQuestions,
  useUpdateQuestion,
} from '@/hooks/useSurveyBuilder';
import {
  defaultExpertTemplate,
  defaultTemplate,
  editLockReason,
  needsOptions,
  nextOrderNo,
  QUESTION_TYPE_OPTIONS,
} from '@/lib/surveyBuilder';
import { QUESTION_TYPE_LABEL } from '@/lib/satisfaction';
import { questionFormSchema } from '@/schemas/surveyBuilderSchemas';
import type {
  SurveyQuestion,
  SurveyQuestionInput,
  SurveyQuestionType,
  SurveyScope,
  SurveyTargetRole,
} from '@/types/satisfaction';
import type { EventStatus } from '@/types/event';

/** 문항 편집 모달 — 신규/수정 공용. 저장 시 검증 후 SurveyQuestionInput 을 돌려준다. */
function QuestionEditorModal({
  open,
  initial,
  scope,
  role,
  orderNo,
  onClose,
  onSave,
  loading,
  error,
}: {
  open: boolean;
  initial: SurveyQuestion | null;
  scope: SurveyScope;
  role: SurveyTargetRole;
  orderNo: number;
  onClose: () => void;
  onSave: (input: SurveyQuestionInput) => void;
  loading: boolean;
  error: string | null;
}) {
  const [type, setType] = useState<SurveyQuestionType>('RATING');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [required, setRequired] = useState(true);
  const [options, setOptions] = useState<string[]>(['', '']);
  const [formError, setFormError] = useState<string | null>(null);

  // 모달이 열릴 때 초기값 동기화.
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
    const parsed = questionFormSchema.safeParse({
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
      survey_scope: scope,
      target_role: role,
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
          onChange={(e) => setType(e.target.value as SurveyQuestionType)}
          options={QUESTION_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />

        <TextField
          label="질문 제목"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="예: 행사 전반 만족도"
          maxLength={200}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="q-desc" className="text-sm font-semibold text-neutral-base">
            보조 설명 (선택)
          </label>
          <input
            id="q-desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="문항 아래에 표시될 안내 문구"
            maxLength={500}
            className="h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
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
                  className="h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={() => setOptions((prev) => prev.filter((_, i) => i !== idx))}
                  disabled={options.length <= 1}
                  aria-label={`선택지 ${idx + 1} 삭제`}
                  className="shrink-0 text-neutral-base/70"
                >
                  −
                </Button>
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

/**
 * 드래그앤드롭으로 순서를 바꿀 수 있는 문항 목록(간소화된 한 줄 카드).
 * 네이티브 HTML5 DnD 사용 — 별도 라이브러리 의존성 없음.
 */
function SortableQuestionList({
  questions,
  editable,
  onEdit,
  onDelete,
  onReorder,
}: {
  questions: SurveyQuestion[];
  editable: boolean;
  onEdit: (q: SurveyQuestion) => void;
  onDelete: (q: SurveyQuestion) => void;
  onReorder: (orderedIds: string[]) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const reset = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  const handleDrop = () => {
    if (dragIndex !== null && overIndex !== null && dragIndex !== overIndex) {
      const reordered = [...questions];
      const [moved] = reordered.splice(dragIndex, 1);
      reordered.splice(overIndex, 0, moved);
      onReorder(reordered.map((q) => q.id));
    }
    reset();
  };

  return (
    <div className="flex flex-col gap-1.5">
      {questions.map((q, idx) => {
        const isDragging = dragIndex === idx;
        const isOver = overIndex === idx && dragIndex !== null && dragIndex !== idx;
        const optionCount = q.options?.length ?? 0;
        return (
          <div
            key={q.id}
            draggable={editable}
            onDragStart={(e) => {
              setDragIndex(idx);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              if (dragIndex === null) return;
              e.preventDefault();
              if (overIndex !== idx) setOverIndex(idx);
            }}
            onDragEnd={reset}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop();
            }}
            className={`group flex items-center gap-2.5 rounded-lg border bg-white px-3 py-2.5 transition-colors ${
              isDragging
                ? 'border-brand opacity-50'
                : isOver
                  ? 'border-brand bg-brand/5'
                  : 'border-border'
            }`}
          >
            {editable && (
              <span
                aria-hidden
                title="드래그하여 순서 변경"
                className="shrink-0 cursor-grab select-none text-neutral-base/30 transition-colors hover:text-neutral-base/60 active:cursor-grabbing"
              >
                ⠿
              </span>
            )}

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-1">
                <span className="truncate text-sm font-bold text-neutral-base">{q.title}</span>
                {q.is_required && (
                  <span className="shrink-0 text-sm font-bold text-brand" title="필수 응답">
                    *
                  </span>
                )}
              </div>
              <span className="truncate text-xs text-neutral-base/50">
                {QUESTION_TYPE_LABEL[q.question_type]}
                {optionCount > 0 && ` · 선택지 ${optionCount}개`}
              </span>
            </div>

            {editable && (
              <div className="ml-3 flex shrink-0 items-center gap-1.5 text-xs font-semibold">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onEdit(q)}
                  className="text-neutral-base/80"
                >
                  수정
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(q)}
                  className="text-brand"
                >
                  삭제
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 만족도 조사 빌더 패널 (관리자 행사 상세 — 만족도 설정 탭).
 * 출처: docs/survey_customization_ideation.md §3.1.
 * 스타트업/전문가 탭으로 문항을 구성. 응답 발생/진행단계 이후엔 편집 잠금(읽기 전용).
 */
export function SurveyBuilderPanel({
  eventId,
  status,
  embedded = false,
  scope = 'EVENT',
}: {
  eventId: string;
  status: EventStatus;
  /** 설정 모달 안에 넣을 때(8-F): 외곽 Card·자체 제목을 생략한다. */
  embedded?: boolean;
  /** EVENT=행사 만족도(역할 탭) / EXPERT=전문가 만족도(스타트업 단일, 8-G). */
  scope?: SurveyScope;
}) {
  const isExpertScope = scope === 'EXPERT';
  const questionsQ = useEventSurveyQuestions(eventId);
  const countQ = useEventSurveyResponseCount(eventId, scope);

  const createM = useCreateQuestion(eventId);
  const updateM = useUpdateQuestion(eventId);
  const deleteM = useDeleteQuestion(eventId);
  const reorderM = useReorderQuestions(eventId);
  const templateM = useAddTemplateQuestions(eventId);

  // 행사·전문가 만족도 모두 스타트업만 응답하므로 대상 역할은 STARTUP 고정(역할 탭 없음).
  const activeRole: SurveyTargetRole = 'STARTUP';
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<SurveyQuestion | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SurveyQuestion | null>(null);

  // 이 빌더가 다루는 스코프의 문항만.
  const questions = useMemo(
    () => (questionsQ.data ?? []).filter((q) => q.survey_scope === scope),
    [questionsQ.data, scope],
  );
  const responseCount = countQ.data ?? 0;
  const lockReason = editLockReason(status, responseCount);
  const editable = lockReason === null;

  const roleQuestions = useMemo(
    () =>
      questions.filter((q) => q.target_role === activeRole).sort((a, b) => a.order_no - b.order_no),
    [questions, activeRole],
  );

  const saveError = createM.isError
    ? (createM.error as Error).message
    : updateM.isError
      ? (updateM.error as Error).message
      : null;

  const openNew = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (q: SurveyQuestion) => {
    setEditing(q);
    setEditorOpen(true);
  };
  const closeEditor = () => {
    setEditorOpen(false);
    setEditing(null);
    createM.reset();
    updateM.reset();
  };

  const handleSave = (input: SurveyQuestionInput) => {
    if (editing) {
      updateM.mutate({ id: editing.id, input }, { onSuccess: closeEditor });
    } else {
      createM.mutate(input, { onSuccess: closeEditor });
    }
  };

  // 드래그앤드롭 결과(새 id 순서)를 기존 order_no 값 집합에 재배치해 변경분만 저장한다.
  const handleReorder = (orderedIds: string[]) => {
    const orderNos = roleQuestions.map((q) => q.order_no); // 이미 order_no 오름차순
    const byId = new Map(roleQuestions.map((q) => [q.id, q]));
    const updates = orderedIds
      .map((id, i) => ({ id, order_no: orderNos[i] }))
      .filter((u) => byId.get(u.id)?.order_no !== u.order_no);
    if (updates.length > 0) reorderM.mutate(updates);
  };

  if (questionsQ.isLoading || countQ.isLoading) {
    const spinner = <Spinner className="h-5 w-5" />;
    return embedded ? (
      <div className="flex items-center justify-center p-8">{spinner}</div>
    ) : (
      <Card className="flex items-center justify-center p-8">{spinner}</Card>
    );
  }

  const Root = embedded ? 'div' : Card;
  return (
    <Root className="flex flex-col gap-4 p-5">
      {!embedded && (
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-bold text-neutral-base">
            {isExpertScope ? '전문가 만족도 설정' : '만족도 조사 설정'}
          </h2>
          <p className="text-sm text-neutral-base/70">
            {isExpertScope
              ? '스타트업이 상담한 전문가/세션마다 응답할 문항을 구성합니다.'
              : '참가자 유형별로 행사 종료 후 받을 만족도 문항을 구성합니다.'}
          </p>
        </div>
      )}

      {lockReason && <Alert tone="info">{lockReason}</Alert>}
      {(questionsQ.isError || countQ.isError) && (
        <Alert tone="error">설문 정보를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
      )}
      {reorderM.isError && (
        <Alert tone="error">순서를 변경하지 못했습니다. 다시 시도해 주세요.</Alert>
      )}
      {deleteM.isError && <Alert tone="error">{(deleteM.error as Error).message}</Alert>}
      {templateM.isError && <Alert tone="error">{(templateM.error as Error).message}</Alert>}

      {/* 문항 목록 (행사·전문가 만족도 모두 스타트업 단일 대상) */}
      {roleQuestions.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-3 py-8">
          <p className="text-sm text-neutral-base/60">등록된 문항이 없습니다.</p>
          {editable && (
            <Button
              variant="outline"
              loading={templateM.isPending}
              onClick={() =>
                templateM.mutate(
                  isExpertScope ? defaultExpertTemplate() : defaultTemplate('STARTUP'),
                )
              }
            >
              기본 문항 불러오기
            </Button>
          )}
        </div>
      ) : (
        <SortableQuestionList
          questions={roleQuestions}
          editable={editable}
          onEdit={openEdit}
          onDelete={setDeleteTarget}
          onReorder={handleReorder}
        />
      )}

      {editable && (
        <div className="flex justify-end">
          <SectionActionButton tone="primary" onClick={openNew}>
            + 문항 추가
          </SectionActionButton>
        </div>
      )}

      <QuestionEditorModal
        key={editing?.id ?? 'new'}
        open={editorOpen}
        initial={editing}
        scope={scope}
        role={activeRole}
        orderNo={editing ? editing.order_no : nextOrderNo(questions, activeRole, scope)}
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
            </>
          ) : null
        }
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteM.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
        }}
      />
    </Root>
  );
}
