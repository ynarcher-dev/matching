import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/common/Card';
import { EventStatusBadge } from '@/components/admin/EventStatusBadge';
import { formatRange } from '@/lib/datetime';
import type { EventRow } from '@/types/event';

interface EventDetailHeaderProps {
  event: EventRow;
  /** 카드 하단 영역(내 권한 배지 + 엑셀/행사 정보 수정 등 액션). */
  footer?: ReactNode;
}

/**
 * 상세 대시보드 헤더 (page_admin_event_detail.md §1.1, §3.2).
 * 행사명·상태·일정 요약을 노출한다. 자율 예약 허용 등 설정은 '행사 정보 수정' 폼에서 다룬다.
 */
export function EventDetailHeader({ event, footer }: EventDetailHeaderProps) {
  return (
    <div className="flex flex-col gap-3">
      <Link
        to="/admin/events"
        className="self-start text-sm font-semibold text-neutral-base/70 transition-colors hover:text-brand"
      >
        ← 행사 목록
      </Link>

      <Card className="flex flex-col gap-4 p-5">
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
              <span
                className="text-[11px] font-medium text-neutral-base/60"
                title={event.status_override_reason ?? undefined}
              >
                상태 고정 · 자동 전환 중지
              </span>
            )}
          </div>
        </div>

        {footer && <div className="border-t border-border pt-4">{footer}</div>}
      </Card>
    </div>
  );
}
