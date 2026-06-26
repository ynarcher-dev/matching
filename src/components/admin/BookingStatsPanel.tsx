import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { BookingScheduleTable } from '@/components/admin/BookingScheduleTable';
import { computeBookingStats, unbookedStartupIds } from '@/lib/booking';
import { participantLabel } from '@/lib/labels';
import type {
  AssignableUser,
  EventParticipantRow,
  EventTable,
  MatchingSlotRow,
} from '@/types/eventDetail';

/** 5% 단위 정적 width 클래스(인라인 스타일 금지 대응 — Tailwind JIT 가 리터럴을 수집). */
const BAR_WIDTH_CLASS: Record<number, string> = {
  0: 'w-[0%]',
  5: 'w-[5%]',
  10: 'w-[10%]',
  15: 'w-[15%]',
  20: 'w-[20%]',
  25: 'w-[25%]',
  30: 'w-[30%]',
  35: 'w-[35%]',
  40: 'w-[40%]',
  45: 'w-[45%]',
  50: 'w-[50%]',
  55: 'w-[55%]',
  60: 'w-[60%]',
  65: 'w-[65%]',
  70: 'w-[70%]',
  75: 'w-[75%]',
  80: 'w-[80%]',
  85: 'w-[85%]',
  90: 'w-[90%]',
  95: 'w-[95%]',
  100: 'w-[100%]',
};

interface BookingStatsPanelProps {
  eventId: string;
  slots: MatchingSlotRow[];
  participants: EventParticipantRow[];
  tables: EventTable[];
  userById: Map<string, AssignableUser>;
  timezone: string;
}

/**
 * 예약 현황 통계 대시보드(BOOKING) (page_admin_event_detail.md §2.2).
 * 예약율 프로그레스 + 예약/미예약 스타트업 수 + 미예약 명단(긴급 알림 대상).
 */
export function BookingStatsPanel({
  eventId,
  slots,
  participants,
  tables,
  userById,
  timezone,
}: BookingStatsPanelProps) {
  const startupIds = useMemo(
    () => participants.filter((p) => p.participant_type === 'STARTUP').map((p) => p.user_id),
    [participants],
  );
  const stats = useMemo(() => computeBookingStats(slots, startupIds), [slots, startupIds]);
  const unbooked = useMemo(
    () => unbookedStartupIds(slots, startupIds),
    [slots, startupIds],
  );

  const ratePct = Math.round(stats.bookingRate * 100);
  // 인라인 스타일 금지 → 5% 버킷의 정적 Tailwind width 클래스로 막대를 그린다.
  const barWidth = BAR_WIDTH_CLASS[Math.round(ratePct / 5) * 5];

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-neutral-base">예약 현황</h2>
          <Link to={`/admin/events/${eventId}/ai-allocation`}>
            <Button variant="outline">AI 자동배치로 이동</Button>
          </Link>
        </div>

        {stats.totalSlots === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-neutral-base/60">
            아직 생성된 매칭 슬롯이 없습니다. 배치 단계에서 슬롯을 생성하면 예약 현황이 표시됩니다.
          </p>
        ) : (
          <>
            <div>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-semibold text-neutral-base">슬롯 예약율</span>
                <span className="font-bold text-neutral-base">{ratePct}%</span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-surface">
                <div className={`h-full rounded-full bg-brand transition-all ${barWidth}`} />
              </div>
              <p className="mt-1 text-xs text-neutral-base/60">
                예약 {stats.bookedSlots} / 전체 {stats.totalSlots} 슬롯 (빈 슬롯 {stats.emptySlots})
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatBox label="전체 슬롯" value={stats.totalSlots} />
              <StatBox label="예약 슬롯" value={stats.bookedSlots} />
              <StatBox label="예약 완료 기업" value={stats.bookedStartupCount} />
              <StatBox label="미예약 기업" value={stats.unbookedStartupCount} tone="warn" />
            </div>
          </>
        )}
      </Card>

      <BookingScheduleTable
        slots={slots}
        participants={participants}
        tables={tables}
        userById={userById}
        timezone={timezone}
      />

      <Card className="flex flex-col gap-3 p-5">
        <h3 className="text-base font-bold text-neutral-base">미예약 스타트업</h3>
        {unbooked.length === 0 ? (
          <p className="text-sm text-neutral-base/60">
            {startupIds.length === 0
              ? '지정된 스타트업이 없습니다.'
              : '모든 스타트업이 1건 이상 예약했습니다.'}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
            {unbooked.map((id) => {
              const u = userById.get(id);
              return (
                <li
                  key={id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                >
                  <span className="text-sm font-medium text-neutral-base">
                    {u ? participantLabel(u) : '(알 수 없는 사용자)'}
                  </span>
                  <span
                    className="rounded-md border border-border px-2 py-1 text-xs font-semibold text-neutral-base/50"
                    title="알림 발송은 Phase 7 에서 연동됩니다."
                  >
                    알림 재발송(준비 중)
                  </span>
                </li>
              );
            })}
          </ul>
        )}
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
