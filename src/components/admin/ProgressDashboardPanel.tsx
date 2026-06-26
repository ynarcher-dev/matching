import { useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { TimeGridSheet } from '@/components/admin/TimeGridSheet';
import { useEventSlots } from '@/hooks/useEventDetail';
import {
  DASHBOARD_POLL_MS,
  useCheckIn,
  useClearAttendance,
  useMarkNoShow,
  useSlotAttendance,
} from '@/hooks/useEventDashboard';
import { latestAttendanceMap, summarizeAttendance } from '@/lib/attendance';
import { participantLabel } from '@/lib/labels';
import type { AttendanceStatus } from '@/types/attendance';
import type {
  AssignableUser,
  EventParticipantRow,
  EventTable,
  MatchingSlotRow,
} from '@/types/eventDetail';

interface ProgressDashboardPanelProps {
  eventId: string;
  participants: EventParticipantRow[];
  tables: EventTable[];
  userById: Map<string, AssignableUser>;
  timezone: string;
  locked: boolean;
}

/**
 * 진행(PROGRESS) 단계 실시간 대시보드 패널 (page_admin_event_detail.md §3.1).
 * 슬롯·출석을 폴링으로 근실시간 갱신하고, 타임그리드로 진행/출석을 감시·조작한다.
 * 슬롯은 자체 폴링 쿼리를 사용(패널이 마운트된 동안에만 폴링).
 */
export function ProgressDashboardPanel({
  eventId,
  participants,
  tables,
  userById,
  timezone,
  locked,
}: ProgressDashboardPanelProps) {
  const slotsQ = useEventSlots(eventId, { refetchInterval: DASHBOARD_POLL_MS });
  const slots = useMemo(() => slotsQ.data ?? [], [slotsQ.data]);
  const slotIds = useMemo(() => slots.map((s) => s.id), [slots]);

  const attendanceQ = useSlotAttendance(eventId, slotIds);
  const attendance = useMemo(
    () => latestAttendanceMap(attendanceQ.data ?? []),
    [attendanceQ.data],
  );
  const summary = useMemo(() => summarizeAttendance(slots, attendance), [slots, attendance]);

  const checkIn = useCheckIn(eventId);
  const clearAttendance = useClearAttendance(eventId);
  const noShow = useMarkNoShow(eventId);
  const [noShowTarget, setNoShowTarget] = useState<MatchingSlotRow | null>(null);

  const pending = checkIn.isPending || clearAttendance.isPending || noShow.isPending;
  const actionError = checkIn.isError
    ? (checkIn.error as Error).message
    : clearAttendance.isError
      ? (clearAttendance.error as Error).message
      : null;

  /** 출석 상태 직접 선택: null=미정(기록 삭제), PRESENT/ABSENT=check_in. */
  const setAttendance = (
    slot: MatchingSlotRow,
    userId: string,
    roleType: 'EXPERT' | 'STARTUP',
    next: AttendanceStatus | null,
  ) => {
    if (next === null) {
      clearAttendance.mutate({ slotId: slot.id, userId, roleType });
    } else {
      checkIn.mutate({ slotId: slot.id, userId, roleType, status: next });
    }
  };

  const handleSetStartup = (slot: MatchingSlotRow, next: AttendanceStatus | null) => {
    if (!slot.startup_id) return;
    setAttendance(slot, slot.startup_id, 'STARTUP', next);
  };

  // 전문가 출석 대리 처리(관리자/스태프) — 전문가 노쇼·현장 누락 대응(0019 RPC 완화).
  const handleSetExpert = (slot: MatchingSlotRow, next: AttendanceStatus | null) => {
    setAttendance(slot, slot.expert_id, 'EXPERT', next);
  };

  const noShowStartup = noShowTarget?.startup_id
    ? userById.get(noShowTarget.startup_id)
    : undefined;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-neutral-base">실시간 진행 현황</h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            실시간 ({Math.round(DASHBOARD_POLL_MS / 1000)}초 갱신)
          </span>
        </div>
        <div className="flex flex-wrap gap-3 text-xs font-semibold text-neutral-base/80">
          <span>
            전문가 출석 {summary.expertPresent}/{summary.expertTotal}
          </span>
          <span>
            스타트업 출석 {summary.startupPresent}/{summary.startupTotal}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <Legend className="bg-emerald-100 text-emerald-700" label="수동" />
        <Legend className="bg-violet-100 text-violet-700" label="AI" />
        <Legend className="bg-orange-100 text-orange-700" label="강제" />
        <span className="ml-1 text-neutral-base/50">
          · 전문가·스타트업의 미정/출석(✓)/불참(✕)을 직접 선택합니다. 실수 시 미정(–)으로 되돌릴 수 있어요.
        </span>
      </div>

      {slotsQ.isError && (
        <Alert tone="error">슬롯을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</Alert>
      )}
      {attendanceQ.isError && (
        <Alert tone="error">출석 정보를 불러오지 못했습니다.</Alert>
      )}
      {actionError && <Alert tone="error">{actionError}</Alert>}

      <TimeGridSheet
        slots={slots}
        participants={participants}
        tables={tables}
        userById={userById}
        attendance={attendance}
        timezone={timezone}
        locked={locked}
        pending={pending}
        onSetStartup={handleSetStartup}
        onSetExpert={handleSetExpert}
        onMarkNoShow={setNoShowTarget}
      />

      <ConfirmModal
        open={noShowTarget !== null}
        onClose={() => setNoShowTarget(null)}
        title="노쇼 처리"
        message={
          noShowStartup
            ? `${participantLabel(noShowStartup)} 세션을 노쇼(불참)로 처리합니다. 사유는 감사 로그에 기록됩니다.`
            : '이 세션을 노쇼(불참)로 처리합니다. 사유는 감사 로그에 기록됩니다.'
        }
        confirmLabel="노쇼 처리"
        requireReason
        reasonLabel="노쇼 사유"
        loading={noShow.isPending}
        error={noShow.isError ? (noShow.error as Error).message : null}
        onConfirm={(reason) => {
          if (noShowTarget) {
            noShow.mutate(
              { slotId: noShowTarget.id, reason },
              { onSuccess: () => setNoShowTarget(null) },
            );
          }
        }}
      />
    </Card>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-neutral-base/70">
      <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-bold ${className}`}>
        {label}
      </span>
    </span>
  );
}
