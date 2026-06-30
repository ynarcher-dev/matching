import { useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { FilterBar, SearchInput, FilterChips } from '@/components/common/FilterBar';
import { Pagination } from '@/components/common/Pagination';
import { useDataTable } from '@/hooks/useDataTable';
import { useEventNotifications, useRetryNotification } from '@/hooks/useNotifications';
import {
  isRetryable,
  maskDestination,
  statusWeight,
  summarizeNotifications,
} from '@/lib/notification';
import {
  CHANNEL_LABELS,
  NOTIFICATION_STATUS_LABELS,
  notificationTypeLabel,
} from '@/lib/labels';
import { formatDateTime } from '@/lib/datetime';
import { BADGE_TONE, type Tone } from '@/lib/tone';
import type { SortValue } from '@/lib/dataTable';
import type { NotificationLog, NotificationStatus } from '@/types/notification';

interface NotificationLogPanelProps {
  eventId: string;
  timezone: string;
}

/** 발송 상태별 의미 tone (9-A 공통 tone). */
const STATUS_TONE: Record<NotificationStatus, Tone> = {
  PENDING: 'warning',
  SENT: 'success',
  FAILED: 'danger',
};
const STATUS_BADGE: Record<NotificationStatus, string> = {
  PENDING: BADGE_TONE[STATUS_TONE.PENDING],
  SENT: BADGE_TONE[STATUS_TONE.SENT],
  FAILED: BADGE_TONE[STATUS_TONE.FAILED],
};

/** 상태 필터 값('ALL' + 실제 상태). */
type StatusFilter = 'ALL' | NotificationStatus;

const STATUS_FILTER_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'ALL', label: '전체' },
  { value: 'PENDING', label: NOTIFICATION_STATUS_LABELS.PENDING },
  { value: 'SENT', label: NOTIFICATION_STATUS_LABELS.SENT },
  { value: 'FAILED', label: NOTIFICATION_STATUS_LABELS.FAILED },
];

/**
 * 알림 발송 현황 (Phase 7 슬라이스 1, security_transactions.md 4장).
 * 8-J: 누적되는 발송 로그를 8-C 공통 DataTable(검색·상태 필터·정렬·30 페이지네이션)로 전환.
 * 예약 생성/변경/취소·예약 시작 안내 등 자동 적재된 알림의 발송 상태와 재시도 횟수·다음 재시도
 * 시각·오류 메시지를 보여주고, 영구 실패 건은 관리자가 수동 재시도한다. 대상(연락처)은 마스킹.
 */
export function NotificationLogPanel({ eventId, timezone }: NotificationLogPanelProps) {
  const logsQ = useEventNotifications(eventId);
  const retry = useRetryNotification(eventId);

  const logs = useMemo<NotificationLog[]>(() => logsQ.data ?? [], [logsQ.data]);
  const summary = useMemo(() => summarizeNotifications(logs), [logs]);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  const filters = useMemo(() => {
    if (statusFilter === 'ALL') return [];
    return [(l: NotificationLog) => l.status === statusFilter];
  }, [statusFilter]);

  const sortValues = useMemo<Record<string, (row: NotificationLog) => SortValue>>(
    () => ({
      status: (l) => statusWeight(l.status),
      type: (l) => notificationTypeLabel(l.notification_type),
      created_at: (l) => l.created_at,
      retry: (l) => l.retry_count,
    }),
    [],
  );

  const table = useDataTable(logs, {
    getSearchText: (l) =>
      [notificationTypeLabel(l.notification_type), maskDestination(l.channel, l.destination), l.content]
        .filter(Boolean)
        .join(' '),
    sortValues,
    filters,
    initialSort: { key: 'created_at', direction: 'desc' },
  });

  const columns = useMemo<DataTableColumn<NotificationLog>[]>(
    () => [
      {
        key: 'status',
        header: '상태',
        sortable: true,
        cell: (l) => (
          <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[l.status]}`}>
            {NOTIFICATION_STATUS_LABELS[l.status]}
          </span>
        ),
      },
      {
        key: 'type',
        header: '유형',
        sortable: true,
        cell: (l) => (
          <span className="whitespace-nowrap font-semibold text-neutral-base">
            {notificationTypeLabel(l.notification_type)}
          </span>
        ),
      },
      {
        key: 'destination',
        header: '채널 · 대상',
        cell: (l) => (
          <span className="whitespace-nowrap text-xs text-neutral-base/70">
            {CHANNEL_LABELS[l.channel]} · {maskDestination(l.channel, l.destination)}
          </span>
        ),
      },
      {
        key: 'content',
        header: '내용',
        className: 'min-w-[260px] max-w-[420px]',
        cell: (l) => (
          <div className="flex flex-col gap-0.5">
            <span className="line-clamp-2 text-neutral-base/90">{l.content}</span>
            {l.error_message && <span className="text-xs text-brand">오류: {l.error_message}</span>}
          </div>
        ),
      },
      {
        key: 'created_at',
        header: '적재 시각',
        sortable: true,
        cell: (l) => (
          <span className="whitespace-nowrap text-xs text-neutral-base/60">
            {formatDateTime(l.created_at, timezone)}
          </span>
        ),
      },
      {
        key: 'retry',
        header: '재시도',
        sortable: true,
        align: 'center',
        cell: (l) => (
          <div className="flex flex-col items-center gap-0.5 text-xs text-neutral-base/60">
            <span>{l.retry_count > 0 ? `${l.retry_count}/3회` : '–'}</span>
            {l.status === 'PENDING' && l.next_retry_at && (
              <span className="whitespace-nowrap text-neutral-base/50">
                다음 {formatDateTime(l.next_retry_at, timezone)}
              </span>
            )}
          </div>
        ),
      },
      {
        key: 'actions',
        header: '조작',
        align: 'right',
        cell: (l) =>
          isRetryable(l) ? (
            <Button variant="outline" onClick={() => retry.mutate(l.id)} disabled={retry.isPending}>
              재시도
            </Button>
          ) : (
            <span className="text-xs text-neutral-base/30">–</span>
          ),
      },
    ],
    [timezone, retry],
  );

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-neutral-base">알림 발송 현황</h2>
          <span className="text-xs text-neutral-base/50">15초마다 자동 갱신</span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatBox label="전체" value={summary.total} />
          <StatBox label="대기/재시도" value={summary.pending} />
          <StatBox label="발송 완료" value={summary.sent} />
          <StatBox label="영구 실패" value={summary.failed} tone="warn" />
        </div>

        {retry.isError && (
          <Alert tone="error">{(retry.error as Error).message ?? '재시도에 실패했습니다.'}</Alert>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <h3 className="text-base font-bold text-neutral-base">발송 로그</h3>

        {logsQ.isError && <Alert tone="error">알림 로그를 불러오지 못했습니다.</Alert>}

        <FilterBar>
          <SearchInput
            value={table.search}
            onChange={table.setSearch}
            placeholder="유형·대상·내용 검색"
          />
          <FilterChips<StatusFilter>
            value={statusFilter}
            onChange={setStatusFilter}
            ariaLabel="발송 상태 필터"
            options={STATUS_FILTER_OPTIONS}
          />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={table.rows}
          rowKey={(l) => l.id}
          sort={table.sort}
          onSort={table.toggleSort}
          minWidthClass="min-w-[900px]"
          emptyMessage={
            logs.length === 0
              ? '아직 발송된 알림이 없습니다. 예약 확정·변경·취소 또는 예약 시작 시 자동으로 적재됩니다.'
              : '검색·필터 조건에 맞는 알림이 없습니다.'
          }
        />

        <Pagination
          page={table.page}
          totalPages={table.totalPages}
          pageSize={table.pageSize}
          total={table.totalFiltered}
          onPageChange={table.setPage}
        />
      </Card>
    </div>
  );
}

function StatBox({
  label,
  value,
  tone = 'base',
}: {
  label: string;
  value: number;
  tone?: 'base' | 'warn';
}) {
  return (
    <div className="rounded-xl border border-border bg-surface/40 px-3 py-3 text-center">
      <p className={`text-2xl font-bold ${tone === 'warn' ? 'text-brand' : 'text-neutral-base'}`}>
        {value}
      </p>
      <p className="mt-0.5 text-xs font-medium text-neutral-base/60">{label}</p>
    </div>
  );
}
