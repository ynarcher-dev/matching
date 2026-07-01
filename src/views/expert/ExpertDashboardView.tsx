import { useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { Tabs } from '@/components/common/Tabs';
import { EventStatusBadge } from '@/components/admin/EventStatusBadge';
import { ExpertScheduleTable } from '@/components/expert/ExpertScheduleTable';
import { ExpertCounselingWorkspace } from '@/components/expert/ExpertCounselingWorkspace';
import { useAuthStore } from '@/stores/authStore';
import { displayName } from '@/lib/labels';
import { formatRange } from '@/lib/datetime';
import { latestAttendanceMap } from '@/lib/attendance';
import { pickActiveSlotId } from '@/lib/expertSchedule';
import {
  useExpertAttendance,
  useExpertTableCodes,
  useMyExpertEvents,
  useMyExpertSlots,
  useSlotStartups,
  useStartCounseling,
} from '@/hooks/useExpertPortal';
import type { EventRow } from '@/types/event';

/**
 * 전문가 메인 대시보드 (docs/expert_dashboard_split_view_ideation.md).
 * 기본 뷰: 프로필 + 행사 스위처 + 전체 상담 일정 표(관리자 DataTable 스타일).
 * 일정의 기업을 열면 화면이 Split View 워크스페이스(좌 기업정보 ↔ 우 상담일지)로 전환된다.
 * 복잡한 카운트다운·수동 출석 카드는 제거하고, 출석은 상담 시작 시 자동 처리한다(§4).
 * 전문가도 참가자 커스텀 JWT 경로이므로 모든 쿼리/RPC 는 participantClient 를 쓴다.
 */
export function ExpertDashboardView() {
  const user = useAuthStore((s) => s.user);
  const myId = user?.id ?? '';

  const eventsQ = useMyExpertEvents();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 워크스페이스(Split View)로 연 슬롯. null 이면 일정 표(기본 뷰). */
  const [workspaceSlotId, setWorkspaceSlotId] = useState<string | null>(null);

  const events = useMemo(() => eventsQ.data ?? [], [eventsQ.data]);
  const tabOptions = useMemo(() => events.map((e) => ({ value: e.id, label: e.title })), [events]);
  // 기본 선택: 진행(PROGRESS) 행사 우선, 없으면 첫 행사.
  const event = useMemo<EventRow | undefined>(() => {
    if (selectedId) return events.find((e) => e.id === selectedId) ?? events[0];
    return events.find((e) => e.status === 'PROGRESS') ?? events[0];
  }, [events, selectedId]);
  const eventId = event?.id ?? '';

  const slotsQ = useMyExpertSlots(eventId, myId);
  const slots = useMemo(() => slotsQ.data ?? [], [slotsQ.data]);

  const startupIds = useMemo(
    () => Array.from(new Set(slots.map((s) => s.startup_id).filter((v): v is string => Boolean(v)))),
    [slots],
  );
  const slotIds = useMemo(() => slots.map((s) => s.id), [slots]);

  const startupsQ = useSlotStartups(eventId, startupIds);
  const tablesQ = useExpertTableCodes(eventId);
  const attendanceQ = useExpertAttendance(eventId, slotIds);

  const startupById = startupsQ.data ?? new Map();
  const tableCodeById = tablesQ.data ?? new Map<string, string>();
  const attendanceMap = useMemo(
    () => latestAttendanceMap(attendanceQ.data ?? []),
    [attendanceQ.data],
  );

  const startM = useStartCounseling(eventId);
  const activeSlotId = useMemo(() => pickActiveSlotId(slots, Date.now()), [slots]);

  if (eventsQ.isLoading) return <FullScreenLoader />;
  if (eventsQ.isError) {
    return (
      <Card className="p-6">
        <Alert tone="error">
          행사 정보를 불러오지 못했습니다. {(eventsQ.error as Error | null)?.message ?? ''}
        </Alert>
      </Card>
    );
  }
  if (!event) {
    return (
      <Card className="p-8">
        <p className="text-center text-sm text-neutral-base/60">
          현재 참가 중인 행사가 없습니다. 행사가 시작되면 상담 일정이 표시됩니다.
        </p>
      </Card>
    );
  }

  const inProgress = event.status === 'PROGRESS';

  // 워크스페이스 모드: Split View 로 일정 하나를 연 상태.
  const workspaceSlot = workspaceSlotId ? slots.find((s) => s.id === workspaceSlotId) : null;
  if (workspaceSlotId && workspaceSlot) {
    return (
      <ExpertCounselingWorkspace
        slots={slots}
        currentSlotId={workspaceSlotId}
        startupById={startupById}
        timezone={event.timezone}
        eventId={eventId}
        inProgress={inProgress}
        onBack={() => setWorkspaceSlotId(null)}
        onStart={(slotId) => startM.mutate(slotId)}
        startPending={startM.isPending}
        startError={startM.isError ? (startM.error as Error).message : null}
        onRefreshStartups={() => startupsQ.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* 전문가 프로필 카드 */}
      <Card className="flex flex-col gap-1 p-5">
        <h1 className="text-lg font-bold text-neutral-base">{user ? displayName(user) : '전문가'}</h1>
        <p className="text-sm text-neutral-base/70">오늘의 상담 일정을 확인하고 진행하세요.</p>
      </Card>

      {events.length > 1 && <Tabs value={eventId} options={tabOptions} onChange={setSelectedId} />}

      <Card className="flex flex-col gap-2 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold text-neutral-base">{event.title}</h2>
          <EventStatusBadge status={event.status} />
        </div>
        <p className="text-sm text-neutral-base/80">
          행사: {formatRange(event.event_start, event.event_end, event.timezone)}
        </p>
        {!inProgress && (
          <Alert tone="info">
            진행(PROGRESS) 단계에서 상담 시작·일지 작성을 할 수 있습니다. 현재는 일정과 기업 자료만 확인할 수 있습니다.
          </Alert>
        )}
      </Card>

      {(slotsQ.isError || startupsQ.isError || attendanceQ.isError) && (
        <Alert tone="error">일부 데이터를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
      )}

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-base font-bold text-neutral-base">전체 상담 일정</h2>
        <ExpertScheduleTable
          slots={slots}
          startupById={startupById}
          tableCodeById={tableCodeById}
          attendanceMap={attendanceMap}
          activeSlotId={activeSlotId}
          timezone={event.timezone}
          onOpen={(s) => setWorkspaceSlotId(s.id)}
        />
      </Card>
    </div>
  );
}
