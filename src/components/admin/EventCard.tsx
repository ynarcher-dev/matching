import { Link } from 'react-router-dom';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { EventStatusBadge } from '@/components/admin/EventStatusBadge';
import { EventPermissionBadge } from '@/components/admin/EventPermissionBadge';
import { canManageEvent } from '@/lib/eventPermission';
import { formatRange } from '@/lib/datetime';
import type { EventWithCounts } from '@/types/event';
import type { OperatorPermission } from '@/types/operator';

interface EventCardProps {
  event: EventWithCounts;
  onEdit: (event: EventWithCounts) => void;
  /** 최고 관리자만 취소 가능. 그 외에는 버튼 숨김. */
  canCancel: boolean;
  onCancel: (event: EventWithCounts) => void;
  /** 현재 사용자의 이 행사 권한(super=OWNER). 배지·편집 버튼 노출에 사용. */
  permission: OperatorPermission | null;
  /** 최고관리자 여부(배지 표기용). */
  isSuper: boolean;
}

/**
 * 행사 요약 카드 (page_admin_event_list.md §1.2).
 * 타이틀·상태 배지·내 권한 배지·중요 일정·참가 통계·상세 바로가기를 담는다.
 */
export function EventCard({ event, onEdit, canCancel, onCancel, permission, isSuper }: EventCardProps) {
  const cancelled = event.status === 'CANCELLED';
  const canEdit = canManageEvent(permission);
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words text-lg font-bold text-neutral-base">{event.title}</h3>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <EventStatusBadge status={event.status} />
          {event.status_override && (
            <span className="text-[11px] font-medium text-neutral-base/60">상태 고정</span>
          )}
          {permission && <EventPermissionBadge permission={permission} isSuper={isSuper} />}
        </div>
      </div>

      <dl className="flex flex-col gap-1.5 text-sm text-neutral-base/80">
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 font-semibold text-neutral-base/60">예약</dt>
          <dd>{formatRange(event.booking_start, event.booking_end, event.timezone)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 font-semibold text-neutral-base/60">행사</dt>
          <dd>{formatRange(event.event_start, event.event_end, event.timezone)}</dd>
        </div>
      </dl>

      <div className="flex items-center gap-2 text-sm text-neutral-base">
        <span className="rounded-md bg-surface px-2 py-1 font-semibold">
          스타트업 {event.startupCount}개사
        </span>
        <span className="rounded-md bg-surface px-2 py-1 font-semibold">
          전문가 {event.expertCount}명
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Link to={`/admin/events/${event.id}`} className="flex-1">
          <Button className="w-full">행사 상세 대시보드</Button>
        </Link>
        {!cancelled && canEdit && (
          <Button variant="outline" onClick={() => onEdit(event)}>
            편집
          </Button>
        )}
        {!cancelled && canCancel && (
          <Button
            variant="outline"
            onClick={() => onCancel(event)}
            className="text-brand hover:bg-danger-surface"
          >
            취소
          </Button>
        )}
      </div>
    </Card>
  );
}
