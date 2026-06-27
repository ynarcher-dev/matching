import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { EventDetailHeader } from '@/components/admin/EventDetailHeader';
import { ParticipantAssignPanel } from '@/components/admin/ParticipantAssignPanel';
import { EventTablesPanel } from '@/components/admin/EventTablesPanel';
import { SlotGenerationPanel } from '@/components/admin/SlotGenerationPanel';
import { BookingStatsPanel } from '@/components/admin/BookingStatsPanel';
import { ProgressDashboardPanel } from '@/components/admin/ProgressDashboardPanel';
import { SlotForcePanel } from '@/components/admin/SlotForcePanel';
import { SurveyBuilderPanel } from '@/components/admin/SurveyBuilderPanel';
import { SurveyReportPanel } from '@/components/admin/SurveyReportPanel';
import { CounselingBuilderPanel } from '@/components/admin/CounselingBuilderPanel';
import { CounselingReportPanel } from '@/components/admin/CounselingReportPanel';
import { NotificationLogPanel } from '@/components/admin/NotificationLogPanel';
import { EventNotificationSettingsPanel } from '@/components/admin/EventNotificationSettingsPanel';
import { PhotoStatusPanel } from '@/components/admin/PhotoStatusPanel';
import {
  useAssignableUsers,
  useEventDetail,
  useEventParticipants,
  useEventSlots,
  useEventTables,
} from '@/hooks/useEventDetail';
import { useToggleSelfBooking } from '@/hooks/useEventDetailMutations';
import { useEventExport } from '@/hooks/useEventExport';
import type { AssignableUser } from '@/types/eventDetail';
import type { EventStatus } from '@/types/event';

type DetailTab =
  | 'assign'
  | 'booking'
  | 'progress'
  | 'force'
  | 'counseling'
  | 'counseling-report'
  | 'survey'
  | 'survey-report'
  | 'notifications'
  | 'notification-settings'
  | 'photos';

const TABS: { value: DetailTab; label: string }[] = [
  { value: 'assign', label: '참가자·테이블' },
  { value: 'booking', label: '예약 현황' },
  { value: 'progress', label: '진행 현황' },
  { value: 'force', label: '강제 조정' },
  { value: 'counseling', label: '상담일지 설정' },
  { value: 'counseling-report', label: '상담일지 결과' },
  { value: 'survey', label: '만족도 설정' },
  { value: 'survey-report', label: '만족도 결과' },
  { value: 'notifications', label: '알림 현황' },
  { value: 'notification-settings', label: '알림 설정' },
  { value: 'photos', label: '사진 현황' },
];

/** 상태별 기본 진입 탭 (page_admin_event_detail.md §1.1 상태 전이 화면 대응). */
function defaultTab(status: EventStatus): DetailTab {
  if (status === 'DRAFT') return 'assign';
  if (status === 'BOOKING') return 'booking';
  if (status === 'PROGRESS') return 'progress';
  if (status === 'ALLOCATION') return 'force';
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
  const exporter = useEventExport(eventId, eventQ.data?.timezone ?? 'Asia/Seoul');

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

      <div className="flex flex-wrap items-center justify-between gap-2">
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
        <Button
          variant="outline"
          onClick={() => exporter.mutate({ title: event.title })}
          disabled={exporter.isPending}
        >
          {exporter.isPending ? '엑셀 생성 중…' : '엑셀 내보내기'}
        </Button>
      </div>

      {exporter.isError && (
        <Alert tone="error">
          엑셀 내보내기에 실패했습니다. {(exporter.error as Error)?.message ?? ''}
        </Alert>
      )}

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
          tables={tables}
          userById={userById}
          timezone={event.timezone}
        />
      )}

      {activeTab === 'progress' && (
        <ProgressDashboardPanel
          eventId={eventId}
          participants={participants}
          tables={tables}
          userById={userById}
          timezone={event.timezone}
          locked={locked}
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

      {activeTab === 'counseling' && (
        <CounselingBuilderPanel eventId={eventId} status={event.status} />
      )}

      {activeTab === 'counseling-report' && (
        <CounselingReportPanel
          eventId={eventId}
          eventTitle={event.title}
          participants={participants}
          userById={userById}
          timezone={event.timezone}
        />
      )}

      {activeTab === 'survey' && <SurveyBuilderPanel eventId={eventId} status={event.status} />}

      {activeTab === 'survey-report' && (
        <SurveyReportPanel
          eventId={eventId}
          participants={participants}
          userById={userById}
          timezone={event.timezone}
        />
      )}

      {activeTab === 'notifications' && (
        <NotificationLogPanel eventId={eventId} timezone={event.timezone} />
      )}

      {activeTab === 'notification-settings' && (
        <EventNotificationSettingsPanel eventId={eventId} />
      )}

      {activeTab === 'photos' && (
        <PhotoStatusPanel
          eventId={eventId}
          participants={participants}
          userById={userById}
          timezone={event.timezone}
        />
      )}
    </div>
  );
}
