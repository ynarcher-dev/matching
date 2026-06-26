import { useMemo } from 'react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { formatRange } from '@/lib/datetime';
import { myBookedSlots } from '@/lib/startupBooking';
import type { MatchingSlotRow } from '@/types/eventDetail';
import type { PortalExpert } from '@/types/startupBooking';

interface MyBookingListProps {
  slots: MatchingSlotRow[];
  expertById: Map<string, PortalExpert>;
  tableCodeById: Map<string, string>;
  myId: string;
  maxSessions: number;
  timezone: string;
  /** BOOKING(또는 자율예약 허용)일 때만 변경/취소 노출. */
  canModify: boolean;
  onChange: (slot: MatchingSlotRow) => void;
  onCancel: (slot: MatchingSlotRow) => void;
}

/** 슬롯의 실제 적용 테이블 코드(table_id 우선, 없으면 전문가 기본 테이블). */
function tableCodeFor(
  slot: MatchingSlotRow,
  expert: PortalExpert | undefined,
  tableCodeById: Map<string, string>,
): string | null {
  const id = slot.table_id ?? expert?.defaultTableId ?? null;
  return id ? (tableCodeById.get(id) ?? null) : null;
}

/**
 * 나의 매칭 예약 현황 (page_startup_booking.md §1.2-2).
 * 예약 완료 세션의 시간·전문가·테이블을 카드로 보여주고, 변경/취소 버튼을 배치한다.
 * 상단에 `예약 현황: N회 / 최대 M회` 요약 배지를 노출한다.
 */
export function MyBookingList({
  slots,
  expertById,
  tableCodeById,
  myId,
  maxSessions,
  timezone,
  canModify,
  onChange,
  onCancel,
}: MyBookingListProps) {
  const mine = useMemo(() => myBookedSlots(slots, myId), [slots, myId]);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-neutral-base">나의 매칭 예약</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-700">
          예약 현황: {mine.length}회 / 최대 {maxSessions}회
        </span>
      </div>

      {mine.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-neutral-base/60">
          아직 예약한 상담이 없습니다. 아래 일정표에서 빈 슬롯을 선택해 신청해 주세요.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {mine.map((slot) => {
            const expert = expertById.get(slot.expert_id);
            const code = tableCodeFor(slot, expert, tableCodeById);
            return (
              <li
                key={slot.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-bold text-neutral-base">
                    {formatRange(slot.start_time, slot.end_time, timezone)}
                  </span>
                  <span className="text-sm text-neutral-base">
                    {expert?.name ?? '(알 수 없는 전문가)'}
                    {expert?.organization ? ` · ${expert.organization}` : ''}
                  </span>
                  <span className="text-xs font-medium text-neutral-base/70">
                    배정 테이블: {code ?? '미지정'}
                  </span>
                </div>
                {canModify && (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="outline"
                      onClick={() => onChange(slot)}
                      className="px-3 py-1.5 text-sm"
                    >
                      시간 변경
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => onCancel(slot)}
                      className="px-3 py-1.5 text-sm text-brand"
                    >
                      예약 취소
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
