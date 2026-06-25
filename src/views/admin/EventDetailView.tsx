import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { EventDetailHeader } from '@/components/admin/EventDetailHeader';
import { ParticipantAssignPanel } from '@/components/admin/ParticipantAssignPanel';
import { EventTablesPanel } from '@/components/admin/EventTablesPanel';
import { SlotGenerationPanel } from '@/components/admin/SlotGenerationPanel';
import { BookingStatsPanel } from '@/components/admin/BookingStatsPanel';
import { SlotForcePanel } from '@/components/admin/SlotForcePanel';
import {
  useAssignableUsers,
  useEventDetail,
  useEventParticipants,
  useEventSlots,
  useEventTables,
} from '@/hooks/useEventDetail';
import { useToggleSelfBooking } from '@/hooks/useEventDetailMutations';
import type { AssignableUser } from '@/types/eventDetail';
import type { EventStatus } from '@/types/event';

type DetailTab = 'assign' | 'booking' | 'force';

const TABS: { value: DetailTab; label: string }[] = [
  { value: 'assign', label: '참가자·테이블' },
  { value: 'booking', label: '예약 현황' },
  { value: 'force', label: '강제 조정' },
];

/** 상태별 기본 진입 탭 (page_admin_event_detail.md §1.1 상태 전이 화면 대응). */
function defaultTab(status: EventStatus): DetailTab {
  if (status === 'DRAFT') return 'assign';
  if (status === 'BOOKING') return 'booking';
  if (status === 'ALLOCATION' || status === 'PROGRESS') return 'force';
  return 'booking';
}

/**
 * 행사 상세 운영 대시보드 (page_admin_event_detail.md).
 * 슬라이스 4 범위: 참가자 지정(DRAFT)·테이블 관리·예약 현황(BOOKING)·강제 조정.
 * 상태에 따라 기본 탭을 고르고, 취소(CANCELLED) 행사는 편집을 잠근다.
 */
export function EventDetailView() {
  const { eventId = '' } = useParams();
  const eventQ = useEventDetail(eventId);
  const participantsQ = useEventParticipants(eventId);
  const tablesQ = useEventTables(eventId);
  const slotsQ = useEventSlots(eventId);
  const usersQ = useAssignableUsers();
  const toggle = useToggleSelfBooking(eventId);

  const [tab, setTab] = useState<DetailTab | null>(null);

  const userById = useMemo(
    () => new Map<string, AssignableUser>((usersQ.data ?? []).map((u) => [u.id, u])),
    [usersQ.data],
  );

  if (eventQ.isLoading) return <FullScreenLoader />;
  if (eventQ.isError || !eventQ.data) {
    return (
      <Card className="p-6">
        <Alert tone="error">
          행사를 불러오지 못했습니다. {(eventQ.error as Error | null)?.message ?? '존재하지 않는 행사입니다.'}
        </Alert>
      </Card>
    );
  }

  const event = eventQ.data;
  const locked = event.status === 'CANCELLED';
  const activeTab = tab ?? defaultTab(event.status);

  const participants = participantsQ.data ?? [];
  const tables = tablesQ.data ?? [];
  const slots = slotsQ.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <EventDetailHeader
        event={event}
        onToggleSelfBooking={(next) => toggle.mutate(next)}
        toggleDisabled={locked || toggle.isPending}
        toggleError={toggle.isError ? (toggle.error as Error).message : null}
      />

      {locked && (
        <Alert tone="info">취소된 행사입니다. 조회만 가능하며 편집·조정 기능은 잠겨 있습니다.</Alert>
      )}

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const active = activeTab === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                active
                  ? 'border-brand bg-brand text-white'
                  : 'border-border bg-white text-neutral-base hover:bg-surface'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {(participantsQ.isError || tablesQ.isError || slotsQ.isError || usersQ.isError) && (
        <Alert tone="error">일부 데이터를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
      )}

      {activeTab === 'assign' && (
        <div className="flex flex-col gap-5">
          <ParticipantAssignPanel
            eventId={eventId}
            participants={participants}
            assignableUsers={usersQ.data ?? []}
            tables={tables}
            locked={locked}
          />
          <EventTablesPanel eventId={eventId} tables={tables} locked={locked} />
          <SlotGenerationPanel
            eventId={eventId}
            event={event}
            participants={participants}
            slots={slots}
            locked={locked}
          />
        </div>
      )}

      {activeTab === 'booking' && (
        <BookingStatsPanel
          eventId={eventId}
          slots={slots}
          participants={participants}
          userById={userById}
        />
      )}

      {activeTab === 'force' && (
        <SlotForcePanel
          eventId={eventId}
          slots={slots}
          participants={participants}
          tables={tables}
          userById={userById}
          timezone={event.timezone}
          locked={locked}
        />
      )}
    </div>
  );
}
