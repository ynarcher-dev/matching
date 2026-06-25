import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { TextField } from '@/components/common/TextField';
import { Alert } from '@/components/common/Alert';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { eventTableSchema } from '@/schemas/eventDetailSchemas';
import type { EventTableFormValues } from '@/schemas/eventDetailSchemas';
import { useSaveEventTable, useDeleteEventTable } from '@/hooks/useEventDetailMutations';
import type { EventTable } from '@/types/eventDetail';

interface EventTablesPanelProps {
  eventId: string;
  tables: EventTable[];
  locked: boolean;
}

const EMPTY: EventTableFormValues = { table_code: '', description: '', is_active: true };

/**
 * 행사장 테이블 관리 (page_admin_event_detail.md §2.1 테이블 지정).
 * 테이블 코드·위치 설명·사용 여부를 등록/편집/삭제한다.
 */
export function EventTablesPanel({ eventId, tables, locked }: EventTablesPanelProps) {
  const [editing, setEditing] = useState<EventTable | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EventTable | null>(null);
  const save = useSaveEventTable(eventId);
  const del = useDeleteEventTable(eventId);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EventTableFormValues>({
    resolver: zodResolver(eventTableSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    reset(
      editing
        ? {
            table_code: editing.table_code,
            description: editing.description ?? '',
            is_active: editing.is_active,
          }
        : EMPTY,
    );
  }, [editing, reset]);

  const onSubmit = handleSubmit((values) => {
    save.mutate(
      { id: editing?.id, values },
      {
        onSuccess: () => {
          setEditing(null);
          reset(EMPTY);
        },
      },
    );
  });

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="text-lg font-bold text-neutral-base">행사장 테이블</h2>

      {!locked && (
        <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-xl border border-border bg-surface/40 p-3" noValidate>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField
              label="테이블 코드"
              placeholder="예: A-1"
              error={errors.table_code?.message}
              {...register('table_code')}
            />
            <TextField
              label="위치 설명(선택)"
              placeholder="예: 2층 좌측 구역"
              error={errors.description?.message}
              {...register('description')}
            />
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-neutral-base">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border text-brand focus:ring-brand/30"
              {...register('is_active')}
            />
            사용 가능
          </label>
          {save.isError && <Alert tone="error">{(save.error as Error).message}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" loading={save.isPending}>
              {editing ? '테이블 저장' : '테이블 추가'}
            </Button>
            {editing && (
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                취소
              </Button>
            )}
          </div>
        </form>
      )}

      {tables.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-neutral-base/60">
          등록된 테이블이 없습니다.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {tables.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0">
                <span className="text-sm font-semibold text-neutral-base">{t.table_code}</span>
                {t.description && (
                  <span className="ml-2 text-sm text-neutral-base/70">{t.description}</span>
                )}
                {!t.is_active && (
                  <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-neutral-base/60">
                    미사용
                  </span>
                )}
              </div>
              {!locked && (
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditing(t)}
                    className="rounded-md border border-border px-2 py-1 text-xs font-semibold text-neutral-base transition-colors hover:bg-surface"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(t)}
                    className="rounded-md border border-border px-2 py-1 text-xs font-semibold text-brand transition-colors hover:bg-danger-surface"
                  >
                    삭제
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="테이블 삭제"
        message={`'${deleteTarget?.table_code}' 테이블을 삭제할까요? 이 테이블을 기본 테이블로 둔 전문가·슬롯의 지정이 해제됩니다.`}
        confirmLabel="삭제"
        loading={del.isPending}
        error={del.isError ? (del.error as Error).message : null}
        onConfirm={() => {
          if (deleteTarget) {
            del.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
          }
        }}
      />
    </Card>
  );
}
