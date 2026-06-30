import { Card } from '@/components/common/Card';
import { SessionStatusBadge } from '@/components/expert/SessionStatusBadge';
import { Badge } from '@/components/common/Badge';
import { formatDateTime } from '@/lib/datetime';
import { attendanceStatusFor } from '@/lib/attendance';
import type { AttendanceLogRow } from '@/types/attendance';
import type { MatchingSlotRow } from '@/types/eventDetail';
import type { SlotStartup } from '@/types/expert';

/**
 * 금일 전체 미팅 일정 리스트 (docs/page_expert_dashboard.md §1.2).
 * 행=시간대 슬롯. 예약 없는 슬롯은 "예약 없음", 활성 슬롯은 강조. 상태 배지·출석 칩 병기.
 */
export function ExpertScheduleList({
  slots,
  startupById,
  tableCodeById,
  attendanceMap,
  activeSlotId,
  timezone,
  onWriteLog,
}: {
  slots: MatchingSlotRow[];
  startupById: Map<string, SlotStartup>;
  tableCodeById: Map<string, string>;
  attendanceMap: Map<string, AttendanceLogRow>;
  activeSlotId: string | null;
  timezone: string;
  /** 일지 작성/조회 가능한 슬롯에서 노출(IN_PROGRESS/COMPLETED). 미지정 시 버튼 숨김. */
  onWriteLog?: (slot: MatchingSlotRow) => void;
}) {
  return (
    <Card className="flex flex-col gap-2 p-5">
      <h2 className="text-base font-bold text-neutral-base">전체 상담 일정</h2>
      {slots.length === 0 ? (
        <p className="py-6 text-center text-sm text-neutral-base/60">
          배정된 상담 슬롯이 없습니다.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {slots.map((slot) => {
            const startup = slot.startup_id ? startupById.get(slot.startup_id) : undefined;
            const active = slot.id === activeSlotId;
            const expertPresent = attendanceStatusFor(attendanceMap, slot.id, slot.expert_id);
            const startupPresent = attendanceStatusFor(attendanceMap, slot.id, slot.startup_id);
            return (
              <li
                key={slot.id}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-3 ${
                  active ? 'rounded-lg bg-brand/5' : ''
                }`}
              >
                <span className="w-16 shrink-0 font-mono text-sm font-semibold text-neutral-base">
                  {formatDateTime(slot.start_time, timezone).slice(-5)}
                </span>
                {slot.startup_id ? (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm text-neutral-base">
                      {startup?.companyName ?? startup?.name ?? '(스타트업)'}
                    </span>
                    <SessionStatusBadge status={slot.session_status} />
                    {tableCodeById.get(slot.table_id ?? '') && (
                      <span className="text-xs text-neutral-base/60">
                        📍 {tableCodeById.get(slot.table_id ?? '')}
                      </span>
                    )}
                    <span className="flex gap-1 text-xs">
                      <AttendanceChip label="전" present={expertPresent} />
                      <AttendanceChip label="스" present={startupPresent} />
                    </span>
                    {onWriteLog &&
                      (slot.session_status === 'IN_PROGRESS' ||
                        slot.session_status === 'COMPLETED') && (
                        <button
                          type="button"
                          onClick={() => onWriteLog(slot)}
                          className="rounded-md border border-border px-2 py-1 text-xs font-semibold text-neutral-base transition-colors hover:bg-surface"
                        >
                          {slot.session_status === 'COMPLETED' ? '일지 보기/수정' : '일지'}
                        </button>
                      )}
                  </>
                ) : (
                  <span className="flex-1 text-sm text-neutral-base/40">예약 없음</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** 출석 상태 칩: 출석=초록, 불참=레드, 미정=회색. */
function AttendanceChip({ label, present }: { label: string; present: 'PRESENT' | 'ABSENT' | null }) {
  const tone =
    present === 'PRESENT'
      ? 'success'
      : present === 'ABSENT'
        ? 'danger'
        : 'muted';
  const mark = present === 'PRESENT' ? '✓' : present === 'ABSENT' ? '✕' : '–';
  return (
    <Badge tone={tone} size="11">
      {label} {mark}
    </Badge>
  );
}
