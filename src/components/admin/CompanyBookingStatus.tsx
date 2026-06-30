import { useMemo, useState } from 'react';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { DataTable, type DataTableColumn } from '@/components/common/DataTable';
import { FilterBar, FilterChips, SearchInput } from '@/components/common/FilterBar';
import { Pagination } from '@/components/common/Pagination';
import { useForceCancel } from '@/hooks/useEventDetailMutations';
import { useDataTable } from '@/hooks/useDataTable';
import { formatDateTime } from '@/lib/datetime';
import { companyName, BOOKING_TYPE_LABELS } from '@/lib/labels';
import type { SortValue } from '@/lib/dataTable';
import type {
  AssignableUser,
  BookingType,
  EventParticipantRow,
  MatchingSlotRow,
} from '@/types/eventDetail';

interface CompanyBookingStatusProps {
  eventId: string;
  slots: MatchingSlotRow[];
  participants: EventParticipantRow[];
  userById: Map<string, AssignableUser>;
  timezone: string;
  /** 행사별 스타트업당 최대 신청 횟수(events.max_sessions_per_startup). */
  maxSessions: number;
  /** 강제 취소 허용(관리 권한 && 미잠금). */
  canManage: boolean;
  /** + 배정 클릭 시 해당 스타트업으로 강제 배정 모달을 연다(관리 권한 시 제공). */
  onAssign?: (startupId: string) => void;
}

/** 예약 경로별 마커 점 색(수동=초록, AI=보라, 강제=주의, 미지정=회색). */
const TYPE_DOT: Record<BookingType, string> = {
  NONE: 'bg-neutral-base/30',
  MANUAL: 'bg-success',
  AUTO_AI: 'bg-ai',
  ADMIN_FORCE: 'bg-warning',
};

/** 진행 상태 필터. */
const STATUS_FILTERS = [
  { value: 'ALL', label: '전체' },
  { value: 'FULL', label: '완료' },
  { value: 'PARTIAL', label: '진행' },
  { value: 'NONE', label: '미신청' },
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number]['value'];
type CompanyStatus = Exclude<StatusFilter, 'ALL'>;

/** 한 스타트업의 예약 1건(시간·전문가·경로). */
interface Booking {
  slot: MatchingSlotRow;
  expertName: string;
  expertOrg: string | null;
}

/** 기업별 집계 행. */
interface CompanyRow {
  startup: AssignableUser;
  bookings: Booking[];
  status: CompanyStatus;
}

/** 취소가 아닌 실제 예약 슬롯인가. */
function isBooked(s: MatchingSlotRow): boolean {
  return s.startup_id !== null && s.session_status !== 'CANCELLED';
}

/**
 * 기업별 배치 현황 (page_admin_event_detail.md §2.2 보강).
 * 참가 스타트업 DB 표(공통 DataTable)와 같은 룩으로 — 검색·상태 필터·정렬 헤더·페이지네이션.
 * 행마다 진행 도트(N/M)와 신청 내역(시간·전문가·경로 칩)을 보여주고, 강제 취소는 각 칩의 ✕ 로.
 */
export function CompanyBookingStatus({
  eventId,
  slots,
  participants,
  userById,
  timezone,
  maxSessions,
  canManage,
  onAssign,
}: CompanyBookingStatusProps) {
  const [cancelTarget, setCancelTarget] = useState<MatchingSlotRow | null>(null);
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const cancel = useForceCancel(eventId);

  // 스타트업별 예약 묶음(전체) — 기업명 순으로 정렬해 정렬 동률 시 이름순을 유지.
  const allRows = useMemo<CompanyRow[]>(() => {
    const startupIds = participants
      .filter((p) => p.participant_type === 'STARTUP')
      .map((p) => p.user_id);

    const bookingsByStartup = new Map<string, Booking[]>();
    for (const s of slots) {
      if (!isBooked(s) || !s.startup_id) continue;
      const expert = userById.get(s.expert_id);
      const list = bookingsByStartup.get(s.startup_id) ?? [];
      list.push({
        slot: s,
        expertName: expert?.name ?? '(알 수 없음)',
        expertOrg: expert?.expert_organization ?? null,
      });
      bookingsByStartup.set(s.startup_id, list);
    }

    const result: CompanyRow[] = [];
    for (const id of startupIds) {
      const startup = userById.get(id);
      if (!startup) continue;
      const bookings = (bookingsByStartup.get(id) ?? []).sort((a, b) =>
        a.slot.start_time.localeCompare(b.slot.start_time),
      );
      const st: CompanyStatus =
        bookings.length >= maxSessions ? 'FULL' : bookings.length === 0 ? 'NONE' : 'PARTIAL';
      result.push({ startup, bookings, status: st });
    }
    return result.sort((a, b) =>
      companyName(a.startup).localeCompare(companyName(b.startup), 'ko'),
    );
  }, [slots, participants, userById, maxSessions]);

  // 요약(전체 기준).
  const summary = useMemo(() => {
    let full = 0;
    let none = 0;
    for (const r of allRows) {
      if (r.status === 'FULL') full += 1;
      else if (r.status === 'NONE') none += 1;
    }
    return { full, none, partial: allRows.length - full - none };
  }, [allRows]);

  const filters = useMemo(
    () => (status === 'ALL' ? [] : [(r: CompanyRow) => r.status === status]),
    [status],
  );
  const sortValues = useMemo<Record<string, (row: CompanyRow) => SortValue>>(
    () => ({
      company: (r) => companyName(r.startup),
      progress: (r) => r.bookings.length,
    }),
    [],
  );
  const table = useDataTable(allRows, {
    getSearchText: (r) =>
      [companyName(r.startup), r.startup.representative_name ?? '', ...r.bookings.map((b) => b.expertName)]
        .join(' '),
    sortValues,
    filters,
    initialSort: { key: 'progress', direction: 'asc' },
  });

  const columns = useMemo<DataTableColumn<CompanyRow>[]>(
    () => [
      {
        key: 'no',
        header: 'No.',
        className: 'w-12',
        cell: (_r, index) => (
          <span className="tabular-nums text-neutral-base/50">
            {(table.page - 1) * table.pageSize + index + 1}
          </span>
        ),
      },
      {
        key: 'company',
        header: '기업명',
        sortable: true,
        className: 'w-44',
        cell: (r) => (
          <span className="font-bold text-neutral-base">{companyName(r.startup)}</span>
        ),
      },
      {
        key: 'rep',
        header: '대표자명',
        className: 'w-28',
        cell: (r) => (
          <span className="text-neutral-base/70">{r.startup.representative_name ?? '-'}</span>
        ),
      },
      {
        key: 'progress',
        header: '진행',
        sortable: true,
        className: 'w-32',
        cell: (r) => <ProgressCell count={r.bookings.length} max={maxSessions} status={r.status} />,
      },
      {
        key: 'bookings',
        header: '신청 내역',
        cell: (r) => {
          // 남은 배정 가능 횟수(최대 - 현재 예약)만큼 + 배정 버튼을 노출한다.
          const remaining = Math.max(0, maxSessions - r.bookings.length);
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              {r.bookings.map((b) => (
                <BookingChip
                  key={b.slot.id}
                  booking={b}
                  timezone={timezone}
                  canManage={canManage}
                  onCancel={setCancelTarget}
                />
              ))}
              {canManage && onAssign
                ? Array.from({ length: remaining }).map((_, i) => (
                    <Button
                      key={i}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAssign(r.startup.id);
                      }}
                      title="이 기업에 전문가 슬롯을 강제 배정"
                      className="h-7 border-dashed text-neutral-base/45 hover:border-brand hover:text-brand"
                    >
                      + 배정
                    </Button>
                  ))
                : r.bookings.length === 0 && (
                    <span className="text-xs text-neutral-base/40">미신청</span>
                  )}
            </div>
          );
        },
      },
    ],
    [table.page, table.pageSize, maxSessions, timezone, canManage, onAssign],
  );

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-neutral-base">기업별 배치 현황</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone="info">
            완료 {summary.full}
          </Badge>
          <Badge tone="neutral">
            진행 {summary.partial}
          </Badge>
          <Badge tone="warning">
            미신청 {summary.none}
          </Badge>
          <span className="text-neutral-base/50">· 최대 {maxSessions}회</span>
        </div>
      </div>

      <FilterBar>
        <SearchInput
          value={table.search}
          onChange={table.setSearch}
          placeholder="기업 · 대표 · 전문가 검색"
        />
        <FilterChips
          value={status}
          options={STATUS_FILTERS}
          onChange={setStatus}
          ariaLabel="진행 상태 필터"
        />
      </FilterBar>

      {cancel.isError && <Alert tone="error">{(cancel.error as Error).message}</Alert>}

      <DataTable
        columns={columns}
        rows={table.rows}
        rowKey={(r) => r.startup.id}
        sort={table.sort}
        onSort={table.toggleSort}
        minWidthClass="min-w-[760px]"
        emptyMessage={
          allRows.length === 0 ? '참가 스타트업이 없습니다.' : '조건에 맞는 기업이 없습니다.'
        }
      />
      <Pagination
        page={table.page}
        totalPages={table.totalPages}
        pageSize={table.pageSize}
        total={table.totalFiltered}
        onPageChange={table.setPage}
      />

      <ConfirmModal
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title="강제 취소"
        message="이 슬롯의 예약을 강제로 취소하고 슬롯을 다시 공개합니다. 사유는 감사 로그에 기록됩니다."
        confirmLabel="강제 취소"
        requireReason
        reasonLabel="취소 사유"
        loading={cancel.isPending}
        error={cancel.isError ? (cancel.error as Error).message : null}
        onConfirm={(reason) => {
          if (cancelTarget) {
            cancel.mutate(
              { slotId: cancelTarget.id, reason },
              { onSuccess: () => setCancelTarget(null) },
            );
          }
        }}
      />
    </Card>
  );
}

function ProgressCell({
  count,
  max,
  status,
}: {
  count: number;
  max: number;
  status: CompanyStatus;
}) {
  // 진행 상태 색: 완료=파란색(info), 진행중=진한 회색(neutral), 미신청=주의(warning).
  const tone = status === 'FULL' ? 'info' : status === 'NONE' ? 'warning' : 'neutral';
  const countText = {
    info: 'text-info',
    warning: 'text-warning',
    neutral: 'text-neutral-base',
  }[tone];
  const dotOn = { info: 'bg-info', warning: 'bg-warning', neutral: 'bg-neutral-base' }[tone];
  return (
    <div className="flex items-center gap-2">
      <span className="flex gap-1">
        {Array.from({ length: max }).map((_, i) => (
          <span key={i} className={`h-2 w-2 rounded-full ${i < count ? dotOn : 'bg-border'}`} />
        ))}
      </span>
      <span className={`whitespace-nowrap text-xs font-bold ${countText}`}>
        {count}/{max}
      </span>
    </div>
  );
}

function BookingChip({
  booking,
  timezone,
  canManage,
  onCancel,
}: {
  booking: Booking;
  timezone: string;
  canManage: boolean;
  onCancel: (slot: MatchingSlotRow) => void;
}) {
  const b = booking;
  const time = formatDateTime(b.slot.start_time, timezone).slice(-5);
  const typeLabel = BOOKING_TYPE_LABELS[b.slot.booking_type];
  const orgPart = b.expertOrg ? ` · ${b.expertOrg}` : '';
  return (
    <span
      title={`${time} · ${b.expertName}${orgPart} · ${typeLabel}`}
      className="inline-flex h-7 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-raised px-2 text-xs"
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${TYPE_DOT[b.slot.booking_type]}`}
        aria-hidden
      />
      <span className="font-bold tabular-nums text-neutral-base">{time}</span>
      <span className="truncate text-neutral-base/75">{b.expertName}</span>
      {canManage && (
        <button
          type="button"
          aria-label="강제 취소"
          title="강제 취소"
          onClick={(e) => {
            e.stopPropagation();
            onCancel(b.slot);
          }}
          className="shrink-0 text-sm leading-none text-neutral-base/40 transition-colors hover:text-neutral-base"
        >
          ×
        </button>
      )}
    </span>
  );
}
