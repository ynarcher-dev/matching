import { useMemo, useState } from 'react';
import { SectionActionButton } from '@/components/common/ActionButton';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { DataTable } from '@/components/common/DataTable';
import { PageToolbar } from '@/components/common/PageToolbar';
import { SearchInput, FilterChips } from '@/components/common/FilterBar';
import { Pagination } from '@/components/common/Pagination';
import {
  buildOperatorColumns,
  operatorSearchText,
  operatorSortValues,
} from '@/components/admin/operatorColumns';
import { OperatorFormModal } from '@/components/admin/OperatorFormModal';
import { OperatorSecretModal } from '@/components/admin/OperatorSecretModal';
import { OperatorPermissionModal } from '@/components/admin/OperatorPermissionModal';
import { useOperators } from '@/hooks/useOperators';
import { useUpdateOperator, useResetOperatorPassword } from '@/hooks/useOperatorMutations';
import { useDataTable } from '@/hooks/useDataTable';
import { useAuthStore } from '@/stores/authStore';
import { summarizeOperators } from '@/lib/operator';
import type { Operator, OperatorSecretResult } from '@/types/operator';

/** 활성 상태 필터 값. */
type ActiveFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

/**
 * 운영자 관리 페이지 (page_admin_operator_permissions.md 4 — 최고관리자 전용).
 * 운영자 목록/생성/수정/비활성화·재활성화/비밀번호 재설정. 권한 배정 UI 는 슬라이스 E.
 */
export function OperatorListView() {
  const currentUserId = useAuthStore((s) => s.user?.id ?? '');
  const { data: operators, isLoading, isError, error } = useOperators();
  const update = useUpdateOperator();
  const reset = useResetOperatorPassword();

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Operator | null>(null);
  const [toggleTarget, setToggleTarget] = useState<Operator | null>(null);
  const [resetTarget, setResetTarget] = useState<Operator | null>(null);
  const [assignTarget, setAssignTarget] = useState<Operator | null>(null);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('ALL');
  const [secret, setSecret] = useState<{ result: OperatorSecretResult; email: string } | null>(
    null,
  );

  const summary = useMemo(() => summarizeOperators(operators ?? []), [operators]);

  const filters = useMemo(() => {
    if (activeFilter === 'ACTIVE') return [(o: Operator) => o.active];
    if (activeFilter === 'INACTIVE') return [(o: Operator) => !o.active];
    return [];
  }, [activeFilter]);

  const openCreate = () => {
    setEditTarget(null);
    setFormOpen(true);
  };
  const openEdit = (op: Operator) => {
    setEditTarget(op);
    setFormOpen(true);
  };

  const table = useDataTable(operators ?? [], {
    getSearchText: operatorSearchText,
    sortValues: operatorSortValues,
    filters,
    initialSort: { key: 'created_at', direction: 'desc' },
  });

  const columns = useMemo(
    () =>
      buildOperatorColumns({
        currentUserId,
        onEdit: openEdit,
        onAssign: setAssignTarget,
        onResetPassword: setResetTarget,
        onToggleActive: setToggleTarget,
      }),
    [currentUserId],
  );

  if (isLoading) return <FullScreenLoader />;

  const hasAny = (operators ?? []).length > 0;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-neutral-base">운영자 관리</h1>
        <SectionActionButton tone="primary" onClick={openCreate}>
          + 운영자 추가
        </SectionActionButton>
      </header>

      {isError && (
        <Alert tone="error">운영자 목록을 불러오지 못했습니다. {(error as Error).message}</Alert>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="전체" value={summary.total} />
        <SummaryCard label="활성" value={summary.active} />
        <SummaryCard label="최고관리자" value={summary.superAdmins} />
        <SummaryCard label="현장 스태프" value={summary.staff} />
      </div>

      <PageToolbar
        search={
          <SearchInput
            value={table.search}
            onChange={table.setSearch}
            placeholder="이름·이메일 검색"
          />
        }
        filters={
          <FilterChips<ActiveFilter>
            value={activeFilter}
            onChange={setActiveFilter}
            ariaLabel="활성 상태 필터"
            options={[
              { value: 'ALL', label: '전체' },
              { value: 'ACTIVE', label: '활성' },
              { value: 'INACTIVE', label: '비활성' },
            ]}
          />
        }
      />

      <DataTable
        columns={columns}
        rows={table.rows}
        rowKey={(op) => op.id}
        sort={table.sort}
        onSort={table.toggleSort}
        minWidthClass="min-w-[860px]"
        emptyMessage={
          hasAny
            ? '검색·필터 조건에 맞는 운영자가 없습니다.'
            : '등록된 운영자가 없습니다. 운영자를 추가해 주세요.'
        }
      />

      <Pagination
        page={table.page}
        totalPages={table.totalPages}
        pageSize={table.pageSize}
        total={table.totalFiltered}
        onPageChange={table.setPage}
      />

      <OperatorFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        operator={editTarget}
        onCreated={(result, email) => setSecret({ result, email })}
      />

      <ConfirmModal
        open={toggleTarget !== null}
        onClose={() => setToggleTarget(null)}
        title={toggleTarget?.active ? '운영자 비활성화' : '운영자 재활성화'}
        confirmLabel={toggleTarget?.active ? '비활성화' : '재활성화'}
        requireReason
        reasonLabel="사유"
        reasonPlaceholder={
          toggleTarget?.active ? '예: 담당자 변경으로 계정 비활성화' : '예: 복귀로 계정 재활성화'
        }
        loading={update.isPending}
        error={update.error ? (update.error as Error).message : null}
        message={
          toggleTarget?.active ? (
            <>
              <span className="font-semibold">{toggleTarget?.name}</span> 님 계정을 비활성화합니다.
              로그인이 즉시 차단되고 행사 권한이 정지됩니다.
            </>
          ) : (
            <>
              <span className="font-semibold">{toggleTarget?.name}</span> 님 계정을 재활성화합니다.
              다시 로그인할 수 있게 됩니다.
            </>
          )
        }
        onConfirm={(reason) => {
          if (!toggleTarget) return;
          update.mutate(
            {
              user_id: toggleTarget.id,
              name: toggleTarget.name,
              role: toggleTarget.role,
              is_super_admin: toggleTarget.is_super_admin,
              active: !toggleTarget.active,
              reason,
            },
            { onSuccess: () => setToggleTarget(null) },
          );
        }}
      />

      <ConfirmModal
        open={resetTarget !== null}
        onClose={() => setResetTarget(null)}
        title="비밀번호 재설정"
        confirmLabel="임시 비밀번호 발급"
        requireReason
        reasonLabel="사유"
        reasonPlaceholder="예: 비밀번호 분실로 재설정 요청"
        loading={reset.isPending}
        error={reset.error ? (reset.error as Error).message : null}
        message={
          <>
            <span className="font-semibold">{resetTarget?.name}</span> 님의 임시 비밀번호를
            발급합니다. 발급된 비밀번호는 1회만 표시됩니다.
          </>
        }
        onConfirm={(reason) => {
          if (!resetTarget) return;
          const email = resetTarget.email;
          reset.mutate(
            { user_id: resetTarget.id, mode: 'temp_password', reason },
            {
              onSuccess: (result) => {
                setResetTarget(null);
                setSecret({ result, email });
              },
            },
          );
        }}
      />

      <OperatorPermissionModal
        open={assignTarget !== null}
        onClose={() => setAssignTarget(null)}
        operator={assignTarget}
      />

      <OperatorSecretModal
        open={secret !== null}
        onClose={() => setSecret(null)}
        result={secret?.result ?? null}
        email={secret?.email}
      />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-xs font-semibold text-neutral-base/60">{label}</span>
      <span className="text-2xl font-bold text-neutral-base">{value}</span>
    </Card>
  );
}
