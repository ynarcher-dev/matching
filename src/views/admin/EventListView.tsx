import { useMemo, useState } from 'react';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Alert';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { DataTable } from '@/components/common/DataTable';
import { FilterBar, SearchInput, FilterChips } from '@/components/common/FilterBar';
import { Pagination } from '@/components/common/Pagination';
import { useDataTable } from '@/hooks/useDataTable';
import { buildEventColumns, eventSearchText, eventSortValues } from '@/components/admin/eventColumns';
import { EventFormModal } from '@/components/admin/EventFormModal';
import { CancelEventModal } from '@/components/admin/CancelEventModal';
import { useEvents } from '@/hooks/useEvents';
import { useMyEventRoles } from '@/hooks/useMyEventRoles';
import { useAuthStore } from '@/stores/authStore';
import { EVENT_STATUS_LABELS } from '@/lib/labels';
import type { EventFilter, EventWithCounts } from '@/types/event';

const FILTER_TABS: { value: EventFilter; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'DRAFT', label: EVENT_STATUS_LABELS.DRAFT },
  { value: 'BOOKING', label: EVENT_STATUS_LABELS.BOOKING },
  { value: 'ALLOCATION', label: EVENT_STATUS_LABELS.ALLOCATION },
  { value: 'PROGRESS', label: EVENT_STATUS_LABELS.PROGRESS },
  { value: 'FINISHED', label: EVENT_STATUS_LABELS.FINISHED },
  { value: 'CANCELLED', label: EVENT_STATUS_LABELS.CANCELLED },
];

/**
 * 행사 목록 및 개설 페이지 (page_admin_event_list.md §1).
 * 상태 필터 탭 + 행사명 검색 + 빈 화면 대응.
 * 공통 테이블(누적 일람·검색·정렬·30 페이지네이션) 보기만 남김.
 */
export function EventListView() {
  const { data: events, isLoading, isError, error } = useEvents();
  const isSuperAdmin = useAuthStore((s) => s.user?.is_super_admin ?? false);
  const myRoles = useMyEventRoles();

  const [filter, setFilter] = useState<EventFilter>('ALL');
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EventWithCounts | null>(null);
  const [cancelTarget, setCancelTarget] = useState<EventWithCounts | null>(null);

  // 상태 필터만 적용한 데이터셋
  const statusFiltered = useMemo(
    () => (events ?? []).filter((e) => filter === 'ALL' || e.status === filter),
    [events, filter],
  );

  const openCreate = () => {
    setEditTarget(null);
    setFormOpen(true);
  };
  const openEdit = (event: EventWithCounts) => {
    setEditTarget(event);
    setFormOpen(true);
  };

  const table = useDataTable(statusFiltered, {
    getSearchText: eventSearchText,
    sortValues: eventSortValues,
    initialSort: { key: 'no', direction: 'desc' },
  });

  const columns = useMemo(
    () =>
      buildEventColumns({
        permissionFor: myRoles.permissionFor,
        isSuper: myRoles.isSuper,
        canCancel: isSuperAdmin,
        onEdit: openEdit,
        onCancel: setCancelTarget,
      }),
    [myRoles, isSuperAdmin],
  );

  if (isLoading) return <FullScreenLoader />;

  const hasAny = (events ?? []).length > 0;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-neutral-base">행사 운영 관리</h1>
        <div className="flex items-center gap-2">
          {/* 행사 개설은 최고관리자만(events INSERT RLS = is_super_admin). */}
          {isSuperAdmin && <Button onClick={openCreate}>+ 새 행사 개설</Button>}
        </div>
      </header>

      {isError && <Alert tone="error">행사 목록을 불러오지 못했습니다. {(error as Error).message}</Alert>}

      <div className="flex flex-col gap-3">
        <FilterBar>
          <SearchInput value={table.search} onChange={table.setSearch} placeholder="행사명 검색" />
          <FilterChips<EventFilter>
            value={filter}
            onChange={setFilter}
            ariaLabel="행사 상태 필터"
            options={FILTER_TABS}
          />
        </FilterBar>
        <DataTable
          columns={columns}
          rows={table.rows}
          rowKey={(e) => e.id}
          sort={table.sort}
          onSort={table.toggleSort}
          minWidthClass="min-w-[1000px]"
          emptyMessage={
            hasAny
              ? '조건에 맞는 행사가 없습니다.'
              : isSuperAdmin
                ? '등록된 행사가 없습니다. 새 행사를 개설해 보세요.'
                : '배정된 행사가 없습니다. 운영본부(최고관리자)에 배정을 요청해 주세요.'
          }
        />
        <Pagination
          page={table.page}
          totalPages={table.totalPages}
          pageSize={table.pageSize}
          total={table.totalFiltered}
          onPageChange={table.setPage}
        />
      </div>

      <EventFormModal open={formOpen} onClose={() => setFormOpen(false)} event={editTarget} />
      <CancelEventModal
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        event={cancelTarget}
      />
    </div>
  );
}
