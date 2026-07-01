import { Card } from '@/components/common/Card';
import { EventStatusBadge } from '@/components/admin/EventStatusBadge';
import { formatRange } from '@/lib/datetime';
import type { EventRow } from '@/types/event';

interface StartupEventHeaderProps {
  /** 본인 참가 행사 목록(2개 이상이면 드롭다운 선택기 노출). */
  events: EventRow[];
  /** 현재 선택된 행사. */
  event: EventRow;
  /** 행사 전환 콜백(선택 id 는 상위 공유 상태에 보존됨). */
  onSelect: (id: string) => void;
}

/**
 * 스타트업 3개 화면(예약·자료·안내) 공통 상단 행사 카드.
 * 행사 선택(드롭다운)·상태 배지·행사/예약 기간을 한 곳에서 표시하며,
 * 선택 상태는 useSelectedStartupEvent 로 화면 간·새로고침 간에 공유·보존된다.
 */
export function StartupEventHeader({ events, event, onSelect }: StartupEventHeaderProps) {
  return (
    <Card className="flex flex-col gap-2 p-5">
      <div className="flex flex-wrap items-center gap-2">
        {events.length > 1 ? (
          // 헤더 제목을 행사 선택 드롭다운으로 사용(참가 행사 2개 이상일 때).
          <div className="relative inline-flex items-center">
            <select
              value={event.id}
              onChange={(e) => onSelect(e.target.value)}
              aria-label="행사 선택"
              className="max-w-[70vw] cursor-pointer appearance-none truncate rounded-lg border border-transparent bg-transparent py-0.5 pl-7 pr-2 text-lg font-bold text-neutral-base transition-colors hover:bg-surface focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            >
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
            <span
              aria-hidden
              className="pointer-events-none absolute left-1.5 text-neutral-base/50"
            >
              ▾
            </span>
          </div>
        ) : (
          <h1 className="text-lg font-bold text-neutral-base">{event.title}</h1>
        )}
        <EventStatusBadge status={event.status} />
      </div>
      <p className="text-sm text-neutral-base/80">
        행사: {formatRange(event.event_start, event.event_end, event.timezone)}
      </p>
      <p className="text-sm text-neutral-base/80">
        예약 기간: {formatRange(event.booking_start, event.booking_end, event.timezone)}
      </p>
    </Card>
  );
}
