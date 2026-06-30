import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { StatBox } from '@/components/common/StatBox';
import { BookingScheduleTable } from '@/components/admin/BookingScheduleTable';
import { CompanyBookingStatus } from '@/components/admin/CompanyBookingStatus';
import { ForceBookingModal } from '@/components/admin/ForceBookingModal';
import { computeBookingStats } from '@/lib/booking';
import type {
  AssignableUser,
  EventParticipantRow,
  EventTable,
  MatchingSlotRow,
} from '@/types/eventDetail';

interface BookingStatsPanelProps {
  slots: MatchingSlotRow[];
  participants: EventParticipantRow[];
  tables: EventTable[];
  userById: Map<string, AssignableUser>;
  timezone: string;
  /** 행사별 스타트업당 최대 신청 횟수(기업별 배치 현황 진행도). */
  maxSessions: number;
  /** 강제 배정에 필요한 행사 ID — 빈 슬롯 클릭 배정을 켜려면 함께 전달. */
  eventId?: string;
  /** 빈 슬롯 클릭 → 강제 배정 허용 여부(관리 권한 && 미잠금). */
  forceAssignEnabled?: boolean;
}

/**
 * 예약 현황 통계 대시보드(BOOKING) (page_admin_event_detail.md §2.2).
 * 예약율 프로그레스 + 예약/미예약 스타트업 수 + 미예약 명단(긴급 알림 대상).
 */
export function BookingStatsPanel({
  slots,
  participants,
  tables,
  userById,
  timezone,
  maxSessions,
  eventId,
  forceAssignEnabled = false,
}: BookingStatsPanelProps) {
  // 강제 배정 모달: open + 미리 선택할 슬롯(빈 슬롯 클릭) / 스타트업(기업별 배치 현황 + 배정).
  const [force, setForce] = useState<{
    open: boolean;
    slot: MatchingSlotRow | null;
    startupId: string | null;
  }>({ open: false, slot: null, startupId: null });
  const startupIds = useMemo(
    () => participants.filter((p) => p.participant_type === 'STARTUP').map((p) => p.user_id),
    [participants],
  );
  const stats = useMemo(
    () => computeBookingStats(slots, startupIds, maxSessions),
    [slots, startupIds, maxSessions],
  );

  // 강제 배정 후보 스타트업(빈 슬롯 클릭 모달용).
  const startups = useMemo(
    () =>
      participants
        .filter((p) => p.participant_type === 'STARTUP')
        .map((p) => userById.get(p.user_id))
        .filter((u): u is AssignableUser => Boolean(u)),
    [participants, userById],
  );

  const canForceAssign = forceAssignEnabled && Boolean(eventId);

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-5 p-5">
        {/* 제목 좌측 · 배치 액션은 카드 헤더 우측(권한 미달 시 숨김). 카드 내부 표준 버튼 크기(md). */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-neutral-base">예약 현황</h2>
          {canForceAssign && eventId && (
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/admin/events/${eventId}/ai-allocation`}>
                <Button variant="outline">AI배치</Button>
              </Link>
              <Button onClick={() => setForce({ open: true, slot: null, startupId: null })}>
                강제 배치
              </Button>
            </div>
          )}
        </div>

        {stats.totalSlots === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-sm text-neutral-base/60">
            아직 생성된 매칭 슬롯이 없습니다. 배치 단계에서 슬롯을 생성하면 예약 현황이 표시됩니다.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatBox label="전체 슬롯" value={stats.totalSlots} />
            <StatBox label="참가기업 수" value={stats.startupCount} />
            <StatBox label="기업당 진행 횟수" value={stats.maxSessions} />
            <StatBox label="총 진행세션" value={stats.requiredSessions} />
            <StatBox label="예약 완료된 세션" value={stats.bookedSlots} />
            <StatBox
              label={`잔여 세션 (${stats.slotBalance < 0 ? '슬롯 추가 필요' : '예약 가능'})`}
              value={stats.slotBalance > 0 ? `+${stats.slotBalance}` : stats.slotBalance}
              tone={stats.slotBalance < 0 ? 'warning' : 'success'}
            />
          </div>
        )}
      </Card>

      <BookingScheduleTable
        slots={slots}
        participants={participants}
        tables={tables}
        userById={userById}
        timezone={timezone}
        onSelectEmptySlot={
          canForceAssign ? (slot) => setForce({ open: true, slot, startupId: null }) : undefined
        }
      />

      {eventId && (
        <CompanyBookingStatus
          eventId={eventId}
          slots={slots}
          participants={participants}
          userById={userById}
          timezone={timezone}
          maxSessions={maxSessions}
          canManage={canForceAssign}
          onAssign={
            canForceAssign
              ? (startupId) => setForce({ open: true, slot: null, startupId })
              : undefined
          }
        />
      )}

      {canForceAssign && eventId && (
        <ForceBookingModal
          open={force.open}
          onClose={() => setForce((s) => ({ ...s, open: false }))}
          eventId={eventId}
          slots={slots}
          startups={startups}
          userById={userById}
          tables={tables}
          timezone={timezone}
          initialSlotId={force.slot?.id ?? null}
          initialStartupId={force.startupId}
        />
      )}
    </div>
  );
}
