import { Link } from 'react-router-dom';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { Toggle } from '@/components/common/Toggle';
import { EventStatusBadge } from '@/components/admin/EventStatusBadge';
import { formatRange } from '@/lib/datetime';
import type { EventRow } from '@/types/event';

interface EventDetailHeaderProps {
  event: EventRow;
  /** 자율 예약 허용 토글 변경. CANCELLED 등 잠금 상태에서는 비활성. */
  onToggleSelfBooking: (next: boolean) => void;
  toggleDisabled: boolean;
  toggleError?: string | null;
}

/**
 * 상세 대시보드 헤더 (page_admin_event_detail.md §1.1, §3.2).
 * 행사명·상태·일정 요약 + 스타트업 자율 예약 허용 토글을 노출한다.
 */
export function EventDetailHeader({
  event,
  onToggleSelfBooking,
  toggleDisabled,
  toggleError,
}: EventDetailHeaderProps) {
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <Link
          to="/admin/events"
          className="text-sm font-semibold text-neutral-base/70 transition-colors hover:text-brand"
        >
          ← 행사 목록
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-bold text-neutral-base">{event.title}</h1>
          <dl className="mt-2 flex flex-col gap-1 text-sm text-neutral-base/80">
            <div className="flex gap-2">
              <dt className="w-12 shrink-0 font-semibold text-neutral-base/60">예약</dt>
              <dd>{formatRange(event.booking_start, event.booking_end, event.timezone)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-12 shrink-0 font-semibold text-neutral-base/60">행사</dt>
              <dd>{formatRange(event.event_start, event.event_end, event.timezone)}</dd>
            </div>
          </dl>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <EventStatusBadge status={event.status} />
          {event.status_override && (
            <span className="text-[11px] font-medium text-neutral-base/60">상태 고정</span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-neutral-base">스타트업 자율 예약 허용</p>
            <p className="text-xs text-neutral-base/60">
              켜면 배치 조율·진행 단계에서도 스타트업이 본인 예약을 직접 변경·취소할 수 있습니다.
            </p>
          </div>
          <Toggle
            checked={event.allow_startup_self_booking}
            onChange={onToggleSelfBooking}
            disabled={toggleDisabled}
            label="스타트업 자율 예약 허용"
          />
        </div>
        {toggleError && <Alert tone="error">{toggleError}</Alert>}
      </div>
    </Card>
  );
}
