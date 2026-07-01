import { Link } from 'react-router-dom';
import { TableActionButton } from '@/components/common/ActionButton';
import { EventStatusBadge } from '@/components/admin/EventStatusBadge';
import { EventPermissionBadge } from '@/components/admin/EventPermissionBadge';
import type { DataTableColumn } from '@/components/common/DataTable';
import type { SortValue } from '@/lib/dataTable';
import { canManageEvent } from '@/lib/eventPermission';
import { formatRange } from '@/lib/datetime';
import type { EventStatus, EventWithCounts } from '@/types/event';
import type { OperatorPermission } from '@/types/operator';

/** 상태 정렬 가중치(진행 순서). */
const STATUS_ORDER: Record<EventStatus, number> = {
  DRAFT: 0,
  BOOKING: 1,
  ALLOCATION: 2,
  PROGRESS: 3,
  FINISHED: 4,
  CANCELLED: 5,
};

interface EventColumnHandlers {
  /** 행사별 현재 사용자 권한(super=OWNER). */
  permissionFor: (eventId: string) => OperatorPermission | null;
  isSuper: boolean;
  /** 최고관리자만 취소 가능. */
  canCancel: boolean;
  onEdit: (event: EventWithCounts) => void;
  onCancel: (event: EventWithCounts) => void;
}

/**
 * 행사 목록 테이블 보기(8-J) 컬럼 정의 + 정렬/검색 헬퍼.
 * 카드(EventCard)와 동일 정보를 누적형 운영 테이블로 일반화한다.
 * 정렬은 행사명·상태·행사 일정·참가 통계에 제공한다.
 */
export function buildEventColumns({
  permissionFor,
  isSuper,
  canCancel,
  onEdit,
  onCancel,
}: EventColumnHandlers): DataTableColumn<EventWithCounts>[] {
  return [
    {
      key: 'no',
      header: 'No.',
      sortable: true,
      align: 'center',
      cell: (e) => <span className="font-semibold text-neutral-base">{e.no}</span>,
    },
    {
      key: 'title',
      header: '행사명',
      sortable: true,
      cell: (e) => (
        <Link
          to={`/admin/events/${e.id}`}
          className="font-semibold text-neutral-base underline-offset-2 hover:text-brand hover:underline"
        >
          {e.title}
        </Link>
      ),
    },
    {
      key: 'status',
      header: '상태',
      sortable: true,
      cell: (e) => <EventStatusBadge status={e.status} />,
    },
    {
      key: 'permission',
      header: '내 권한',
      cell: (e) => {
        const permission = permissionFor(e.id);
        return permission ? (
          <EventPermissionBadge permission={permission} isSuper={isSuper} />
        ) : (
          <span className="text-neutral-base/40">–</span>
        );
      },
    },
    {
      key: 'booking',
      header: '예약 기간',
      cell: (e) => (
        <span className="whitespace-nowrap text-neutral-base/70">
          {formatRange(e.booking_start, e.booking_end, e.timezone)}
        </span>
      ),
    },
    {
      key: 'event',
      header: '행사 기간',
      sortable: true,
      cell: (e) => (
        <span className="whitespace-nowrap text-neutral-base/70">
          {formatRange(e.event_start, e.event_end, e.timezone)}
        </span>
      ),
    },
    {
      key: 'startup',
      header: '스타트업',
      sortable: true,
      align: 'center',
      cell: (e) => <span className="font-semibold text-neutral-base">{e.startupCount}</span>,
    },
    {
      key: 'expert',
      header: '전문가',
      sortable: true,
      align: 'center',
      cell: (e) => <span className="font-semibold text-neutral-base">{e.expertCount}</span>,
    },
    {
      key: 'actions',
      header: '조작',
      align: 'center',
      cell: (e) => {
        const cancelled = e.status === 'CANCELLED';
        const canEdit = canManageEvent(permissionFor(e.id));
        return (
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <Link to={`/admin/events/${e.id}`}>
              <TableActionButton>상세</TableActionButton>
            </Link>
            {!cancelled && canEdit && (
              <TableActionButton onClick={() => onEdit(e)}>편집</TableActionButton>
            )}
            {!cancelled && canCancel && (
              <TableActionButton tone="danger" onClick={() => onCancel(e)}>
                취소
              </TableActionButton>
            )}
          </div>
        );
      },
    },
  ];
}

/** 정렬 값 추출(행사명·상태·행사 일정·참가 통계). */
export const eventSortValues: Record<string, (row: EventWithCounts) => SortValue> = {
  no: (e) => e.no,
  title: (e) => e.title,
  status: (e) => STATUS_ORDER[e.status],
  event: (e) => e.event_start,
  startup: (e) => e.startupCount,
  expert: (e) => e.expertCount,
};

/** 키워드 검색 대상 텍스트(행사명). */
export function eventSearchText(e: EventWithCounts): string {
  return e.title;
}
