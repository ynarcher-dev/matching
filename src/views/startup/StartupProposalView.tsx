import { useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { StartupEventHeader } from '@/components/startup/StartupEventHeader';
import { ProposalUploadPanel } from '@/components/startup/ProposalUploadPanel';
import { ReferenceUrlPanel } from '@/components/startup/ReferenceUrlPanel';
import { CounselingRequestPanel } from '@/components/startup/CounselingRequestPanel';
import {
  PORTAL_POLL_MS,
  useEventExperts,
  useEventSlots,
  useEventTableCodes,
  useSelectedStartupEvent,
  type EventTableInfo,
} from '@/hooks/useStartupPortal';
import type { PortalExpert } from '@/types/startupBooking';

/**
 * 스타트업 자료 첨부 페이지 (startup_portal_layout_simplification_plan.md §3.2).
 * 세 카드로 분리: ①상담 전문가별 요청사항(행사 단위) ②소개서/IR 제출 ③URL 공유(사용자 단위).
 * 텍스트 입력은 모두 자동 저장(저장 버튼 없음)하고, 상단에 공통 행사 카드를 노출한다.
 */
export function StartupProposalView() {
  const user = useAuthStore((s) => s.user);
  const myId = user?.id ?? '';

  const { eventsQ, events, event, eventId, setSelectedId } = useSelectedStartupEvent();
  const timezone = event?.timezone ?? 'Asia/Seoul';
  const finished = event?.status === 'FINISHED';

  const slotsQ = useEventSlots(eventId, { refetchInterval: PORTAL_POLL_MS });
  const expertsQ = useEventExperts(eventId);
  const tablesQ = useEventTableCodes(eventId);
  const slots = slotsQ.data ?? [];
  const experts = useMemo(() => expertsQ.data ?? [], [expertsQ.data]);
  const expertById = useMemo(
    () => new Map<string, PortalExpert>(experts.map((e) => [e.userId, e])),
    [experts],
  );
  const tableInfoById = useMemo(
    () => tablesQ.data ?? new Map<string, EventTableInfo>(),
    [tablesQ.data],
  );

  if (eventsQ.isLoading) return <FullScreenLoader />;
  if (eventsQ.isError) {
    return (
      <Card className="p-6">
        <Alert tone="error">
          정보를 불러오지 못했습니다. {(eventsQ.error as Error | null)?.message ?? ''}
        </Alert>
      </Card>
    );
  }

  if (!myId) {
    return (
      <Card className="p-8">
        <p className="text-center text-sm text-neutral-base/60">로그인 정보를 확인할 수 없습니다.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {event && (
        <StartupEventHeader events={events} event={event} onSelect={setSelectedId} />
      )}

      {/* §1 상담 전문가별 요청사항(행사 단위) */}
      {expertsQ.isError || slotsQ.isError ? (
        <Alert tone="error">
          예약 정보를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.
        </Alert>
      ) : (
        event && (
          <CounselingRequestPanel
            slots={slots}
            expertById={expertById}
            tableInfoById={tableInfoById}
            myId={myId}
            eventId={eventId}
            timezone={timezone}
            editable={!finished}
          />
        )
      )}

      {/* §2 소개서/IR 제출 · §3 URL 공유(사용자 단위) */}
      <ProposalUploadPanel userId={myId} timezone={timezone} />
      <ReferenceUrlPanel userId={myId} />
    </div>
  );
}
