import { useMemo, useState } from 'react';
import { Alert } from '@/components/common/Alert';
import { Card } from '@/components/common/Card';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { StartupEventHeader } from '@/components/startup/StartupEventHeader';
import { ExpertCounselingWorkspace } from '@/components/expert/ExpertCounselingWorkspace';
import { ExpertScheduleTable } from '@/components/expert/ExpertScheduleTable';
import { pickActiveSlotId } from '@/lib/expertSchedule';
import { useAuthStore } from '@/stores/authStore';
import {
  useExpertTableCodes,
  useMyExpertEvents,
  useMyExpertSlots,
  useSlotStartups,
  useStartCounseling,
} from '@/hooks/useExpertPortal';
import type { EventRow } from '@/types/event';

export function ExpertDashboardView() {
  const user = useAuthStore((s) => s.user);
  const myId = user?.id ?? '';

  const eventsQ = useMyExpertEvents();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workspaceSlotId, setWorkspaceSlotId] = useState<string | null>(null);

  const events = useMemo(() => eventsQ.data ?? [], [eventsQ.data]);
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

  const startupsQ = useSlotStartups(eventId, startupIds);
  const tablesQ = useExpertTableCodes(eventId);

  const startupById = startupsQ.data ?? new Map();
  const tableCodeById = tablesQ.data ?? new Map<string, string>();

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
          현재 참여 중인 행사가 없습니다. 행사가 시작되면 상담 일정이 표시됩니다.
        </p>
      </Card>
    );
  }

  const inProgress = event.status === 'PROGRESS';
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
      <StartupEventHeader events={events} event={event} onSelect={setSelectedId} />

      {!inProgress && (
        <Alert tone="info">
          진행(PROGRESS) 단계에서 상담 시작 및 일지 작성이 가능합니다. 현재는 일정과 기업 자료만 확인할 수 있습니다.
        </Alert>
      )}

      {(slotsQ.isError || startupsQ.isError) && (
        <Alert tone="error">
          일부 데이터를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.
        </Alert>
      )}

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-base font-bold text-neutral-base">상담일정</h2>
        <ExpertScheduleTable
          slots={slots}
          startupById={startupById}
          tableCodeById={tableCodeById}
          activeSlotId={activeSlotId}
          timezone={event.timezone}
          onOpen={(s) => setWorkspaceSlotId(s.id)}
        />
      </Card>
    </div>
  );
}
