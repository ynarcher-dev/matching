import { useMemo } from 'react';
import { Badge } from '@/components/common/Badge';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { TableTag } from '@/components/common/TableTag';
import { formatRange } from '@/lib/datetime';
import { myBookedSlots } from '@/lib/startupBooking';
import type { EventTableInfo } from '@/hooks/useStartupPortal';
import type { MatchingSlotRow } from '@/types/eventDetail';
import type { PortalExpert } from '@/types/startupBooking';

interface MyBookingListProps {
  slots: MatchingSlotRow[];
  expertById: Map<string, PortalExpert>;
  tableInfoById: Map<string, EventTableInfo>;
  myId: string;
  maxSessions: number;
  timezone: string;
  /** BOOKING(또는 자율예약 허용)일 때만 변경/취소 노출. */
  canModify: boolean;
  onChange: (slot: MatchingSlotRow) => void;
  onCancel: (slot: MatchingSlotRow) => void;
}

/** 슬롯의 실제 적용 테이블 정보(table_id 우선, 없으면 전문가 기본 테이블). */
function tableInfoFor(
  slot: MatchingSlotRow,
  expert: PortalExpert | undefined,
  tableInfoById: Map<string, EventTableInfo>,
): EventTableInfo | null {
  const id = slot.table_id ?? expert?.defaultTableId ?? null;
  return id ? (tableInfoById.get(id) ?? null) : null;
}

/**
 * 나의 매칭 예약 현황 (page_startup_booking.md §1.2-2).
 * 예약 완료 세션의 시간·전문가·테이블을 카드로 보여주고, 변경/취소 버튼을 배치한다.
 * 상단에 `예약 현황: N회 / 최대 M회` 요약 배지를 노출한다.
 * 상담 희망사항 작성은 '자료 첨부' 페이지로 분리했다(CounselingRequestPanel).
 */
export function MyBookingList({
  slots,
  expertById,
  tableInfoById,
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
        <Badge tone="success">
          예약 현황: {mine.length}회 / 최대 {maxSessions}회
        </Badge>
      </div>

      {mine.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-neutral-base/60">
          아직 예약한 상담이 없습니다. 아래 일정표에서 빈 슬롯을 선택해 신청해 주세요.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {mine.map((slot) => {
            const expert = expertById.get(slot.expert_id);
            const table = tableInfoFor(slot, expert, tableInfoById);
            return (
              <li
                key={slot.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3.5 shadow-sm"
              >
                {/* 헤더: 상담 시간 + 확정 상태 */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span aria-hidden className="text-lg leading-none">🗓️</span>
                    <span className="text-sm font-bold text-neutral-base sm:text-base">
                      {formatRange(slot.start_time, slot.end_time, timezone)}
                    </span>
                  </div>
                  <Badge tone="success" icon="✓">
                    예약 확정
                  </Badge>
                </div>

                {/* 본문: 전문가 · 배정 테이블 */}
                <div className="flex flex-col gap-2 border-t border-border/70 pt-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span aria-hidden className="w-5 text-center text-neutral-base/45">👤</span>
                    <span className="font-semibold text-neutral-base">
                      {expert?.name ?? '(알 수 없는 전문가)'}
                    </span>
                    {expert?.organization && (
                      <span className="text-neutral-base/60">· {expert.organization}</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 text-sm">
                      <span aria-hidden className="w-5 text-center text-neutral-base/45">📍</span>
                      <span className="text-neutral-base/70">배정 테이블</span>
                      {table?.code ? (
                        <TableTag code={table.code} />
                      ) : (
                        <span className="text-neutral-base/50">미지정</span>
                      )}
                    </div>
                    {table?.description && (
                      <p className="pl-7 text-xs text-neutral-base/60">{table.description}</p>
                    )}
                  </div>
                </div>

                {/* 액션: 변경/취소 (수정 가능한 단계에서만) */}
                {canModify && (
                  <div className="flex gap-2 border-t border-border/70 pt-3">
                    <Button
                      variant="outline"
                      onClick={() => onChange(slot)}
                      className="flex-1 px-3 py-1.5 text-sm sm:flex-none"
                    >
                      시간 변경
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => onCancel(slot)}
                      className="flex-1 px-3 py-1.5 text-sm text-brand sm:flex-none"
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
