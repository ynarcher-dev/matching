import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Card } from '@/components/common/Card';
import { SectionActionButton, TableActionButton } from '@/components/common/ActionButton';
import { Badge } from '@/components/common/Badge';
import { TextField } from '@/components/common/TextField';
import { Alert } from '@/components/common/Alert';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { SelectBox } from '@/components/common/SelectBox';
import { eventTableSchema } from '@/schemas/eventDetailSchemas';
import type { EventTableFormValues } from '@/schemas/eventDetailSchemas';
import {
  useSaveEventTable,
  useDeleteEventTable,
  useDeleteEventTables,
  useSetTableExpert,
  useSetTableManager,
} from '@/hooks/useEventDetailMutations';
import { useEventOperators } from '@/hooks/useOperators';
import type { AssignableUser, EventParticipantRow, EventTable } from '@/types/eventDetail';

interface EventTablesPanelProps {
  eventId: string;
  tables: EventTable[];
  /** 참가자 명단(담당 전문가 지정에 EXPERT 행만 사용). */
  participants: EventParticipantRow[];
  /** user_id → 사용자(전문가 이름 표시용). */
  userById: Map<string, AssignableUser>;
  locked: boolean;
  /** 테이블 현장 담당자 지정 권한(OWNER/MANAGER). false 면 담당자는 읽기전용. */
  canManage: boolean;
}

/** 현장 담당자 셀렉트 옵션(행사 배정 오퍼레이터). */
type ManagerOption = { userId: string; name: string };

const EMPTY: EventTableFormValues = { table_code: '', description: '', is_active: true };

/** 삭제 확인 대상: 단건(테이블) 또는 복수(선택 id 목록). */
type DeleteTarget = { kind: 'single'; table: EventTable } | { kind: 'bulk'; ids: string[] };

/**
 * 행사장 테이블 관리 (page_admin_event_detail.md §2.1 테이블 지정).
 * 테이블 코드·위치 설명·사용 여부를 등록/편집/삭제한다.
 * 공통 DataTable + 체크박스 복수 선택 삭제(명단 표와 동일 규약)를 따른다.
 */
export function EventTablesPanel({
  eventId,
  tables,
  participants,
  userById,
  locked,
  canManage,
}: EventTablesPanelProps) {
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  // 추가 폼에서 고른 담당 전문가(참가자 id). ''=미지정.
  const [formExpertId, setFormExpertId] = useState('');
  // 추가 폼에서 고른 현장 담당자(오퍼레이터 user_id). ''=미지정.
  const [formManagerId, setFormManagerId] = useState('');
  // 복수 선택(삭제용). 목록에서 사라진 항목은 selectedIds 계산 시 걸러낸다.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const save = useSaveEventTable(eventId);
  const del = useDeleteEventTable(eventId);
  const delMany = useDeleteEventTables(eventId);
  const setExpert = useSetTableExpert(eventId);
  const setManager = useSetTableManager(eventId);

  // 현장 담당자 후보 = 이 행사에 배정된 오퍼레이터(STAFF+). 이름순 정렬.
  const operatorsQ = useEventOperators(eventId);
  const managers: ManagerOption[] = useMemo(
    () =>
      (operatorsQ.data ?? [])
        .map((o) => ({ userId: o.user_id, name: o.operator_name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [operatorsQ.data],
  );

  // 담당 전문가 지정 대상: 참가 전문가만. 이름순으로 정렬해 셀렉트에 나열한다.
  const experts: ExpertOption[] = useMemo(
    () =>
      participants
        .filter((p) => p.participant_type === 'EXPERT')
        .map((p) => ({ row: p, user: userById.get(p.user_id) ?? null }))
        .sort((a, b) => (a.user?.name ?? '').localeCompare(b.user?.name ?? '', 'ko')),
    [participants, userById],
  );
  const occupantOf = (tableId: string) =>
    experts.find((e) => e.row.default_table_id === tableId) ?? null;

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clearSelected = () => setSelected(new Set());

  // 전체 선택/해제(명단 표와 동일한 규약).
  const allSelected = tables.length > 0 && tables.every((t) => selected.has(t.id));
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) tables.forEach((t) => next.delete(t.id));
      else tables.forEach((t) => next.add(t.id));
      return next;
    });

  // 실제 목록에 존재하는 선택 항목만 삭제 대상으로 삼는다.
  const tableIds = useMemo(() => new Set(tables.map((t) => t.id)), [tables]);
  const selectedIds = useMemo(
    () => [...selected].filter((id) => tableIds.has(id)),
    [selected, tableIds],
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EventTableFormValues>({
    resolver: zodResolver(eventTableSchema),
    defaultValues: EMPTY,
  });

  const onSubmit = handleSubmit((values) => {
    save.mutate(
      { values },
      {
        onSuccess: (tableId) => {
          // 추가 시 담당 전문가·현장 담당자를 함께 배정(선택했을 때만).
          if (formExpertId) {
            setExpert.mutate({ tableId, participantId: formExpertId });
          }
          if (formManagerId) {
            setManager.mutate({ tableId, userId: formManagerId });
          }
          reset(EMPTY);
          setFormExpertId('');
          setFormManagerId('');
        },
      },
    );
  });

  const columns = useMemo<DataTableColumn<EventTable>[]>(() => {
    const cols: DataTableColumn<EventTable>[] = [
      {
        key: 'table_code',
        header: '테이블 코드',
        cell: (t) => (
          <div className="flex items-center gap-2">
            <span className="font-semibold text-neutral-base">{t.table_code}</span>
            {!t.is_active && (
              <Badge tone="muted" className="text-neutral-base/60">
                미사용
              </Badge>
            )}
          </div>
        ),
      },
      {
        key: 'description',
        header: '위치 설명',
        cell: (t) =>
          t.description ? (
            <span className="text-neutral-base/70">{t.description}</span>
          ) : (
            <span className="text-neutral-base/40">-</span>
          ),
      },
      {
        key: 'expert',
        header: '담당 전문가',
        cell: (t) => {
          const occupant = occupantOf(t.id);
          if (locked) {
            return (
              <span className="text-neutral-base/80">
                {occupant ? (occupant.user?.name ?? '(이름 미상)') : '미지정'}
              </span>
            );
          }
          // 셀 클릭이 행 선택을 토글하지 않도록 stopPropagation.
          return (
            <span onClick={(e) => e.stopPropagation()}>
              <ExpertSelect
                value={occupant?.row.id ?? ''}
                onChange={(participantId) =>
                  setExpert.mutate({ tableId: t.id, participantId: participantId || null })
                }
                experts={experts}
                currentTableId={t.id}
                disabled={setExpert.isPending}
                ariaLabel={`${t.table_code} 담당 전문가`}
              />
            </span>
          );
        },
      },
      {
        key: 'manager',
        header: '현장 담당자',
        cell: (t) => {
          const managerName = t.manager_user_id
            ? (managers.find((m) => m.userId === t.manager_user_id)?.name ?? '(배정 외 담당자)')
            : null;
          if (locked || !canManage) {
            return (
              <span className="text-neutral-base/80">{managerName ?? '미지정'}</span>
            );
          }
          return (
            <span onClick={(e) => e.stopPropagation()}>
              <ManagerSelect
                value={t.manager_user_id ?? ''}
                onChange={(userId) => setManager.mutate({ tableId: t.id, userId: userId || null })}
                managers={managers}
                disabled={setManager.isPending}
                ariaLabel={`${t.table_code} 현장 담당자`}
              />
            </span>
          );
        },
      },
    ];

    if (!locked) {
      cols.unshift({
        key: 'select',
        header: (
          <button
            type="button"
            onClick={toggleAll}
            aria-pressed={allSelected}
            aria-label="전체 선택"
            className="inline-flex items-center"
          >
            <SelectBox checked={allSelected} />
          </button>
        ),
        align: 'center',
        className: 'w-10',
        cell: (t) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleOne(t.id);
            }}
            aria-pressed={selected.has(t.id)}
            aria-label="선택"
            className="inline-flex items-center"
          >
            <SelectBox checked={selected.has(t.id)} />
          </button>
        ),
      });
      cols.push({
        key: 'actions',
        header: '조작',
        align: 'center',
        className: 'w-20',
        cell: (t) => (
          <span onClick={(e) => e.stopPropagation()}>
            <TableActionButton
              type="button"
              onClick={() => setDeleteTarget({ kind: 'single', table: t })}
              tone="danger"
            >
              삭제
            </TableActionButton>
          </span>
        ),
      });
    }

    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    locked,
    canManage,
    experts,
    managers,
    selected,
    allSelected,
    setExpert.isPending,
    setManager.isPending,
  ]);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="text-lg font-bold text-neutral-base">행사장 테이블</h2>

      {!locked && (
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
          noValidate
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[150px] flex-1">
              <TextField
                label="테이블 코드"
                placeholder="예: A-1"
                error={errors.table_code?.message}
                {...register('table_code')}
              />
            </div>
            <div className="min-w-[150px] flex-1">
              <TextField
                label="위치 설명(선택)"
                placeholder="예: 2층 좌측 구역"
                error={errors.description?.message}
                {...register('description')}
              />
            </div>
            <div className="flex min-w-[150px] flex-1 flex-col gap-1.5">
              <label className="text-sm font-semibold text-neutral-base">담당 전문가(선택)</label>
              <ExpertSelect
                value={formExpertId}
                onChange={setFormExpertId}
                experts={experts}
                disabled={experts.length === 0}
                ariaLabel="담당 전문가"
                className="h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:opacity-50"
              />
            </div>
            {canManage && (
              <div className="flex min-w-[150px] flex-1 flex-col gap-1.5">
                <label className="text-sm font-semibold text-neutral-base">현장 담당자(선택)</label>
                <ManagerSelect
                  value={formManagerId}
                  onChange={setFormManagerId}
                  managers={managers}
                  disabled={managers.length === 0}
                  ariaLabel="현장 담당자"
                  className="h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:opacity-50"
                />
              </div>
            )}
            <SectionActionButton type="submit" tone="primary" loading={save.isPending}>
              테이블 추가
            </SectionActionButton>
          </div>
          {experts.length === 0 && (
            <p className="text-xs text-neutral-base/50">
              참가 전문가를 먼저 추가하면 담당자를 지정할 수 있습니다.
            </p>
          )}
          {save.isError && <Alert tone="error">{(save.error as Error).message}</Alert>}
        </form>
      )}

      {setExpert.isError && (
        <Alert tone="error">
          담당 전문가 지정에 실패했습니다. {(setExpert.error as Error).message}
        </Alert>
      )}

      {setManager.isError && (
        <Alert tone="error">
          현장 담당자 지정에 실패했습니다. {(setManager.error as Error).message}
        </Alert>
      )}

      {!locked && selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted px-3 py-2">
          <span className="text-sm font-medium text-neutral-base">
            {selectedIds.length}개 선택됨
          </span>
          <div className="flex items-center gap-2">
            <SectionActionButton onClick={clearSelected}>선택 해제</SectionActionButton>
            <SectionActionButton
              tone="danger"
              onClick={() => setDeleteTarget({ kind: 'bulk', ids: selectedIds })}
              loading={delMany.isPending}
            >
              선택 {selectedIds.length}개 삭제
            </SectionActionButton>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={tables}
        rowKey={(t) => t.id}
        minWidthClass="min-w-[640px]"
        emptyMessage="등록된 테이블이 없습니다."
      />

      <ConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="테이블 삭제"
        message={
          deleteTarget?.kind === 'single'
            ? `'${deleteTarget.table.table_code}' 테이블을 삭제할까요? 이 테이블을 기본 테이블로 둔 전문가·슬롯의 지정이 해제됩니다.`
            : `선택한 ${deleteTarget?.kind === 'bulk' ? deleteTarget.ids.length : 0}개 테이블을 삭제할까요? 이 테이블들을 기본 테이블로 둔 전문가·슬롯의 지정이 해제됩니다.`
        }
        confirmLabel="삭제"
        loading={del.isPending || delMany.isPending}
        error={
          del.isError
            ? (del.error as Error).message
            : delMany.isError
              ? (delMany.error as Error).message
              : null
        }
        onConfirm={() => {
          if (!deleteTarget) return;
          if (deleteTarget.kind === 'single') {
            del.mutate(deleteTarget.table.id, { onSuccess: () => setDeleteTarget(null) });
          } else {
            delMany.mutate(deleteTarget.ids, {
              onSuccess: () => {
                clearSelected();
                setDeleteTarget(null);
              },
            });
          }
        }}
      />
    </Card>
  );
}

/** 담당 전문가 셀렉트 옵션(참가 전문가 행 + 표시용 사용자). */
type ExpertOption = { row: EventParticipantRow; user: AssignableUser | null };

/**
 * 담당 전문가 셀렉트(생성·편집 폼과 목록 행에서 동일 구조로 재사용).
 * 이미 다른 테이블에 배치된 전문가는 목록에서 제외하고, 이 테이블의 현재 담당자만 남긴다.
 */
function ExpertSelect({
  value,
  onChange,
  experts,
  currentTableId,
  disabled = false,
  ariaLabel,
  className = 'h-7 rounded-md border border-border bg-surface-raised px-2 text-sm text-neutral-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:opacity-50',
}: {
  value: string;
  onChange: (participantId: string) => void;
  experts: ExpertOption[];
  /** 이 테이블의 현재 담당자는 이미 배치돼 있어도 선택지에 남긴다. */
  currentTableId?: string;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  // 미배치 전문가 + 이 테이블 담당자만 노출(다른 테이블에 배치된 전문가는 숨김).
  const selectable = experts.filter(
    (e) => !e.row.default_table_id || e.row.default_table_id === currentTableId,
  );
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className={className}
    >
      <option value="">미지정</option>
      {selectable.map((e) => (
        <option key={e.row.id} value={e.row.id}>
          {e.user?.name ?? '(이름 미상)'}
        </option>
      ))}
    </select>
  );
}

/**
 * 현장 담당자 셀렉트(생성 폼·목록 행에서 동일 구조로 재사용).
 * 후보는 이 행사에 배정된 오퍼레이터. 한 담당자가 여러 테이블을 맡을 수 있어 필터링하지 않는다.
 */
function ManagerSelect({
  value,
  onChange,
  managers,
  disabled = false,
  ariaLabel,
  className = 'h-7 rounded-md border border-border bg-surface-raised px-2 text-sm text-neutral-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:opacity-50',
}: {
  value: string;
  onChange: (userId: string) => void;
  managers: ManagerOption[];
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className={className}
    >
      <option value="">미지정</option>
      {managers.map((m) => (
        <option key={m.userId} value={m.userId}>
          {m.name}
        </option>
      ))}
    </select>
  );
}
