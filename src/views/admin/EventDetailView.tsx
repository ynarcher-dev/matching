import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import { Modal } from '@/components/common/Modal';
import { Tabs } from '@/components/common/Tabs';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { EventDetailHeader } from '@/components/admin/EventDetailHeader';
import { EventPermissionBadge } from '@/components/admin/EventPermissionBadge';
import { ParticipantAssignPanel } from '@/components/admin/ParticipantAssignPanel';
import { EventTablesPanel } from '@/components/admin/EventTablesPanel';
import { SlotGenerationPanel } from '@/components/admin/SlotGenerationPanel';
import { BookingStatsPanel } from '@/components/admin/BookingStatsPanel';
import { ProgressDashboardPanel } from '@/components/admin/ProgressDashboardPanel';
import { SurveyBuilderPanel } from '@/components/admin/SurveyBuilderPanel';
import { SurveyReportPanel } from '@/components/admin/SurveyReportPanel';
import { ExpertSurveyReportPanel } from '@/components/admin/ExpertSurveyReportPanel';
import { CounselingBuilderPanel } from '@/components/admin/CounselingBuilderPanel';
import { CounselingReportPanel } from '@/components/admin/CounselingReportPanel';
import { NotificationLogPanel } from '@/components/admin/NotificationLogPanel';
import { EventNotificationSettingsPanel } from '@/components/admin/EventNotificationSettingsPanel';
import { EventFormModal } from '@/components/admin/EventFormModal';
import { PhotoStatusPanel } from '@/components/admin/PhotoStatusPanel';
import {
  useAssignableUsers,
  useEventDetail,
  useEventParticipants,
  useEventSlots,
  useEventTables,
} from '@/hooks/useEventDetail';
import { useEventExport } from '@/hooks/useEventExport';
import { useMyEventRoles } from '@/hooks/useMyEventRoles';
import { useEventOperators } from '@/hooks/useOperators';
import { OPERATOR_PERMISSION_LABELS } from '@/lib/labels';
import { canManageEvent, hasCapability, type EventCapability } from '@/lib/eventPermission';
import { computeProgressStats } from '@/lib/booking';
import type { AssignableUser } from '@/types/eventDetail';
import type { EventStatus } from '@/types/event';

type DetailTab =
  | 'tables'
  | 'startups'
  | 'experts'
  | 'booking'
  | 'progress'
  | 'counseling'
  | 'survey'
  | 'expert-survey'
  | 'photos'
  | 'notifications';

/**
 * 행사 상세 탭 (8-E 재구성, page_admin_event_detail.md §1.2).
 * 순서: 참가 스타트업 → 참가 전문가 → 테이블 세팅 → 예약·강제조정 → 진행 현황
 *       → 상담일지 → 행사 만족도 → 전문가 만족도 → 증빙사진 → 행사알림.
 * 운영형 탭(상담일지·만족도·알림)은 결과/현황을 기본으로 보여주고, 설정은 보조 영역에 둔다
 * (8-F 에서 우측 상단 버튼 + 모달로 전환 예정).
 */
const TABS: { value: DetailTab; label: string }[] = [
  { value: 'startups', label: '참가 스타트업' },
  { value: 'experts', label: '참가 전문가' },
  { value: 'tables', label: '테이블 세팅' },
  { value: 'booking', label: '예약관리' },
  { value: 'progress', label: '진행관리' },
  { value: 'counseling', label: '상담일지' },
  { value: 'survey', label: '행사 만족도' },
  { value: 'expert-survey', label: '전문가 만족도' },
  { value: 'photos', label: '증빙사진' },
  { value: 'notifications', label: '행사알림' },
];

/**
 * 탭별 요구 권한 (page_admin_operator_permissions.md §5.2).
 * manage=설정·배정·배치 / staff=출석·사진 / view=조회·리포트.
 * 권한 미달 탭은 숨긴다(서버 RLS/RPC 가 최종 차단).
 * 결과 중심 탭은 `view` 로 노출하되, 내부 설정·강제조정 영역은 canManage 로 별도 게이팅한다.
 */
const TAB_CAPABILITY: Record<DetailTab, EventCapability> = {
  tables: 'manage',
  startups: 'manage',
  experts: 'manage',
  booking: 'view',
  progress: 'staff',
  counseling: 'view',
  survey: 'view',
  'expert-survey': 'view',
  photos: 'staff',
  notifications: 'view',
};

/** 상태별 기본 진입 탭 (page_admin_event_detail.md §1.1 상태 전이 화면 대응). */
function defaultTab(status: EventStatus): DetailTab {
  if (status === 'DRAFT') return 'tables';
  if (status === 'BOOKING' || status === 'ALLOCATION') return 'booking';
  if (status === 'PROGRESS') return 'progress';
  if (status === 'FINISHED') return 'counseling';
  return 'tables';
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
  const exporter = useEventExport(eventId, eventQ.data?.timezone ?? 'Asia/Seoul');
  const myRoles = useMyEventRoles();
  const myPermission = myRoles.permissionFor(eventId);
  // 이 행사에 권한을 받은 운영자 목록(전체 조회는 최고관리자 RLS 한정).
  const operatorsQ = useEventOperators(myRoles.isSuper ? eventId : null);

  const [tab, setTab] = useState<DetailTab | null>(null);
  // 8-F: 결과 중심 탭의 설정은 우측 상단 버튼 → 모달로 연다.
  const [settingsTab, setSettingsTab] = useState<
    'counseling' | 'survey' | 'expert-survey' | 'notifications' | null
  >(null);
  // 상세에서 바로 행사 정보를 수정하는 모달(목록과 동일한 EventFormModal 재사용).
  // 운영자(관리자) 배정도 이 모달의 '관리자' 섹션에서 처리한다.
  const [editOpen, setEditOpen] = useState(false);

  const userById = useMemo(
    () => new Map<string, AssignableUser>((usersQ.data ?? []).map((u) => [u.id, u])),
    [usersQ.data],
  );

  if (eventQ.isLoading || myRoles.isLoading) return <FullScreenLoader />;

  // 권한 없는 행사 직접 접근(§5.2) — RLS 로 데이터도 비지만 명시적으로 안내한다.
  if (!myRoles.isSuper && myPermission === null) {
    return (
      <Card className="p-6">
        <Alert tone="error">
          이 행사에 대한 접근 권한이 없습니다. 행사 권한이 필요하면 운영본부(최고관리자)에 문의해 주세요.
        </Alert>
      </Card>
    );
  }
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
  const canManage = canManageEvent(myPermission);

  const participants = participantsQ.data ?? [];
  const tables = tablesQ.data ?? [];
  const slots = slotsQ.data ?? [];

  // 권한별 노출 탭. 미달 탭은 숨기고, 선택/기본 탭이 가려지면 첫 노출 탭으로 대체.
  const visibleTabs = TABS.filter((t) => hasCapability(myPermission, TAB_CAPABILITY[t.value]));
  const preferredTab = tab ?? defaultTab(event.status);
  const activeTab = visibleTabs.some((t) => t.value === preferredTab)
    ? preferredTab
    : (visibleTabs[0]?.value ?? 'booking');

  return (
    <div className="flex flex-col gap-5">
      <EventDetailHeader
        event={event}
        footer={
          (myPermission || myRoles.isSuper) && (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-2">
                {myPermission && (
                  <EventPermissionBadge permission={myPermission} isSuper={myRoles.isSuper} />
                )}
                {myRoles.isSuper && (operatorsQ.data?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-neutral-base/60">권한 부여</span>
                    {operatorsQ.data!.map((op) => (
                      <span
                        key={op.id}
                        className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-neutral-base"
                      >
                        {op.operator_name}
                        <span className="text-neutral-base/50">
                          {' · '}
                          {OPERATOR_PERMISSION_LABELS[op.permission]}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* 상세에서 바로 행사 정보 수정(목록으로 돌아갈 필요 없이). 편집은 MANAGER 이상. */}
                {canManage && !locked && (
                  <Button variant="outline" onClick={() => setEditOpen(true)}>
                    행사 정보 수정
                  </Button>
                )}
                {/* 다운로드는 정책상 MANAGER 이상(§3.3). */}
                {canManage && (
                  <Button
                    variant="outline"
                    onClick={() => exporter.mutate({ title: event.title })}
                    disabled={exporter.isPending}
                  >
                    {exporter.isPending ? '엑셀 생성 중…' : '엑셀 내보내기'}
                  </Button>
                )}
              </div>
            </div>
          )
        }
      />

      {locked && (
        <Alert tone="info">취소된 행사입니다. 조회만 가능하며 편집·조정 기능은 잠겨 있습니다.</Alert>
      )}

      <Tabs<DetailTab>
        value={activeTab}
        options={visibleTabs}
        onChange={setTab}
        ariaLabel="행사 상세 탭"
      />

      {exporter.isError && (
        <Alert tone="error">
          엑셀 내보내기에 실패했습니다. {(exporter.error as Error)?.message ?? ''}
        </Alert>
      )}

      {(participantsQ.isError || tablesQ.isError || slotsQ.isError || usersQ.isError) && (
        <Alert tone="error">일부 데이터를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
      )}

      {activeTab === 'tables' && (
        <div className="flex flex-col gap-5">
          <SlotGenerationPanel
            eventId={eventId}
            event={event}
            participants={participants}
            slots={slots}
            locked={locked}
          />
          <EventTablesPanel
            eventId={eventId}
            tables={tables}
            participants={participants}
            userById={userById}
            locked={locked}
          />
        </div>
      )}

      {activeTab === 'startups' && (
        <ParticipantAssignPanel
          eventId={eventId}
          participants={participants}
          assignableUsers={usersQ.data ?? []}
          tables={tables}
          locked={locked}
          lockedRole="STARTUP"
        />
      )}

      {activeTab === 'experts' && (
        <ParticipantAssignPanel
          eventId={eventId}
          participants={participants}
          assignableUsers={usersQ.data ?? []}
          tables={tables}
          locked={locked}
          lockedRole="EXPERT"
        />
      )}

      {activeTab === 'booking' && (
        <div className="flex flex-col gap-5">
          <BookingStatsPanel
            slots={slots}
            participants={participants}
            tables={tables}
            userById={userById}
            timezone={event.timezone}
            maxSessions={event.max_sessions_per_startup}
            eventId={eventId}
            forceAssignEnabled={canManage && !locked}
          />
        </div>
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

      {activeTab === 'counseling' && (
        <CounselingReportPanel
          eventId={eventId}
          eventTitle={event.title}
          participants={participants}
          userById={userById}
          timezone={event.timezone}
          onOpenSettings={canManage ? () => setSettingsTab('counseling') : undefined}
        />
      )}

      {activeTab === 'survey' && (
        <SurveyReportPanel
          eventId={eventId}
          participants={participants}
          userById={userById}
          timezone={event.timezone}
          onOpenSettings={canManage ? () => setSettingsTab('survey') : undefined}
        />
      )}

      {activeTab === 'expert-survey' && (
        <ExpertSurveyReportPanel
          eventId={eventId}
          participants={participants}
          userById={userById}
          timezone={event.timezone}
          satisfactionPolicy={event.satisfaction_policy}
          totalSessions={computeProgressStats(slots).total}
          onOpenSettings={canManage ? () => setSettingsTab('expert-survey') : undefined}
        />
      )}

      {activeTab === 'photos' && (
        <PhotoStatusPanel
          eventId={eventId}
          participants={participants}
          userById={userById}
          timezone={event.timezone}
        />
      )}

      {activeTab === 'notifications' && (
        <div className="flex flex-col gap-3">
          {canManage && (
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setSettingsTab('notifications')}>
                행사알림 설정
              </Button>
            </div>
          )}
          <NotificationLogPanel eventId={eventId} timezone={event.timezone} />
        </div>
      )}

      {/* 8-F: 결과 탭 설정 모달. 우측 상단 버튼으로만 열고, 빌더는 외곽 Card 없이 렌더한다. */}
      <Modal
        open={settingsTab === 'counseling'}
        onClose={() => setSettingsTab(null)}
        title="상담일지 설정"
      >
        <CounselingBuilderPanel eventId={eventId} status={event.status} embedded />
      </Modal>
      <Modal
        open={settingsTab === 'survey'}
        onClose={() => setSettingsTab(null)}
        title="행사 만족도 설정"
      >
        <SurveyBuilderPanel eventId={eventId} status={event.status} embedded />
      </Modal>
      <Modal
        open={settingsTab === 'expert-survey'}
        onClose={() => setSettingsTab(null)}
        title="전문가 만족도 설정"
      >
        <SurveyBuilderPanel eventId={eventId} status={event.status} embedded scope="EXPERT" />
      </Modal>
      <Modal
        open={settingsTab === 'notifications'}
        onClose={() => setSettingsTab(null)}
        title="행사알림 설정"
      >
        <EventNotificationSettingsPanel eventId={eventId} />
      </Modal>

      {/* 상세에서 행사 정보 수정(목록과 동일한 폼 재사용, event 전달 시 편집 모드).
          관리자(운영자) 배정도 이 폼의 '관리자' 섹션에서 처리한다. */}
      {canManage && !locked && (
        <EventFormModal open={editOpen} onClose={() => setEditOpen(false)} event={event} />
      )}
    </div>
  );
}
