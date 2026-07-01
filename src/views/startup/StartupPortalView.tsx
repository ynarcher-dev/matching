import { useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { FullScreenLoader } from '@/components/common/FullScreenLoader';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { StartupEventHeader } from '@/components/startup/StartupEventHeader';
import { MyBookingList } from '@/components/startup/MyBookingList';
import { BookingSlotsGrid } from '@/components/startup/BookingSlotsGrid';
import { ChangeBookingModal } from '@/components/startup/ChangeBookingModal';
import { SatisfactionPanel } from '@/components/startup/SatisfactionPanel';
import { ExpertSatisfactionPanel } from '@/components/startup/ExpertSatisfactionPanel';
import { PublicCommentsPanel } from '@/components/startup/PublicCommentsPanel';
import { useAuthStore } from '@/stores/authStore';
import { formatRange } from '@/lib/datetime';
import {
  PORTAL_POLL_MS,
  useBookSlot,
  useCancelBooking,
  useChangeBooking,
  useEventExperts,
  useEventSlots,
  useEventTableCodes,
  useExpertAvatars,
  useSelectedStartupEvent,
  type EventTableInfo,
} from '@/hooks/useStartupPortal';
import type { EventRow } from '@/types/event';
import type { MatchingSlotRow } from '@/types/eventDetail';
import type { PortalExpert } from '@/types/startupBooking';

/** 본인 직접 예약 변경/취소가 가능한 단계인지(BOOKING 기본 + 자율예약 토글 예외). */
function canModify(event: EventRow): boolean {
  if (event.status === 'BOOKING') return true;
  return (
    event.allow_startup_self_booking &&
    (event.status === 'ALLOCATION' || event.status === 'PROGRESS')
  );
}

/**
 * 스타트업 예약 포탈 메인 (page_startup_booking.md §1, §2).
 * 행사 스위처 + 나의 예약 현황 + 예약 신청 일정표. 예약/변경/취소는 RPC 단일 트랜잭션.
 */
export function StartupPortalView() {
  const user = useAuthStore((s) => s.user);
  const myId = user?.id ?? '';

  const { eventsQ, events, event, eventId, setSelectedId } = useSelectedStartupEvent();

  const expertsQ = useEventExperts(eventId);
  const slotsQ = useEventSlots(eventId, { refetchInterval: PORTAL_POLL_MS });
  const tablesQ = useEventTableCodes(eventId);

  const slots = slotsQ.data ?? [];
  const experts = useMemo(() => expertsQ.data ?? [], [expertsQ.data]);
  const expertById = useMemo(
    () => new Map<string, PortalExpert>(experts.map((e) => [e.userId, e])),
    [experts],
  );
  // 상세 위치(description)까지 담은 리치 맵. 그리드 하위 컴포넌트에는 코드 문자열 맵으로 파생해 전달.
  const tableInfoById = useMemo(
    () => tablesQ.data ?? new Map<string, EventTableInfo>(),
    [tablesQ.data],
  );
  const tableCodeById = useMemo(
    () => new Map<string, string>([...tableInfoById].map(([id, v]) => [id, v.code])),
    [tableInfoById],
  );
  const avatarsQ = useExpertAvatars(eventId, experts);
  const avatarUrls = avatarsQ.data ?? new Map<string, string>();

  // 모달 상태
  const [bookTarget, setBookTarget] = useState<MatchingSlotRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<MatchingSlotRow | null>(null);
  const [changeFrom, setChangeFrom] = useState<MatchingSlotRow | null>(null);

  const bookM = useBookSlot(eventId);
  const cancelM = useCancelBooking(eventId);
  const changeM = useChangeBooking(eventId);

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
          현재 참가 중인 행사가 없습니다. 행사가 시작되면 예약 일정표가 표시됩니다.
        </p>
      </Card>
    );
  }

  const modifiable = canModify(event);
  const bookable = event.status === 'BOOKING';
  const finished = event.status === 'FINISHED';
  // 만족도 수집 정책(8-D/8-G)에 따라 종료 후 노출 패널을 가른다.
  const policy = event.satisfaction_policy;
  const showEventSurvey = policy === 'EVENT_ONLY' || policy === 'BOTH';
  const showExpertSurvey = policy === 'EXPERT_ONLY' || policy === 'BOTH';

  const closeBook = () => {
    setBookTarget(null);
    bookM.reset();
  };
  const closeCancel = () => {
    setCancelTarget(null);
    cancelM.reset();
  };
  const closeChange = () => {
    setChangeFrom(null);
    changeM.reset();
  };

  return (
    <div className="flex flex-col gap-5">
      <StartupEventHeader events={events} event={event} onSelect={setSelectedId} />

      {(expertsQ.isError || slotsQ.isError || tablesQ.isError) && (
        <Alert tone="error">일부 데이터를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
      )}

      <MyBookingList
        slots={slots}
        expertById={expertById}
        tableInfoById={tableInfoById}
        myId={myId}
        maxSessions={event.max_sessions_per_startup}
        timezone={event.timezone}
        canModify={modifiable}
        onChange={(slot) => setChangeFrom(slot)}
        onCancel={(slot) => setCancelTarget(slot)}
      />

      {finished ? (
        <>
          {showEventSurvey && <SatisfactionPanel eventId={eventId} />}
          {showExpertSurvey && (
            <ExpertSatisfactionPanel eventId={eventId} timezone={event.timezone} />
          )}
          <PublicCommentsPanel eventId={eventId} timezone={event.timezone} />
        </>
      ) : (
        <BookingSlotsGrid
          experts={experts}
          slots={slots}
          avatarUrls={avatarUrls}
          tableCodeById={tableCodeById}
          myId={myId}
          maxSessions={event.max_sessions_per_startup}
          allowDuplicateExpert={event.allow_duplicate_expert}
          timezone={event.timezone}
          canBook={bookable}
          onBook={(slot) => setBookTarget(slot)}
          onRefresh={() => slotsQ.refetch()}
          refreshing={slotsQ.isFetching}
        />
      )}

      {/* 신규 예약 확인 */}
      <ConfirmModal
        open={Boolean(bookTarget)}
        onClose={closeBook}
        title="상담 예약"
        confirmLabel="예약하기"
        loading={bookM.isPending}
        error={bookM.isError ? (bookM.error as Error).message : null}
        message={
          bookTarget ? (
            <>
              해당 시간[
              <span className="font-bold">
                {formatRange(bookTarget.start_time, bookTarget.end_time, event.timezone)}
              </span>
              ]에{' '}
              <span className="font-bold">
                {expertById.get(bookTarget.expert_id)?.name ?? '전문가'}
              </span>{' '}
              전문가와의 상담을 예약하시겠습니까?
            </>
          ) : null
        }
        onConfirm={() => {
          if (!bookTarget) return;
          bookM.mutate(bookTarget.id, { onSuccess: closeBook });
        }}
      />

      {/* 예약 취소 확인(사유 선택) */}
      <ConfirmModal
        open={Boolean(cancelTarget)}
        onClose={closeCancel}
        title="예약 취소"
        confirmLabel="예약 취소"
        loading={cancelM.isPending}
        error={cancelM.isError ? (cancelM.error as Error).message : null}
        message="상담 일정을 취소하시겠습니까? 취소된 시간은 다른 기업이 즉시 예약할 수 있게 됩니다."
        onConfirm={(reason) => {
          if (!cancelTarget) return;
          cancelM.mutate({ slotId: cancelTarget.id, reason }, { onSuccess: closeCancel });
        }}
      />

      {/* 예약 시간 변경 */}
      <ChangeBookingModal
        open={Boolean(changeFrom)}
        fromSlot={changeFrom}
        slots={slots}
        expertById={expertById}
        myId={myId}
        maxSessions={event.max_sessions_per_startup}
        allowDuplicateExpert={event.allow_duplicate_expert}
        timezone={event.timezone}
        onClose={closeChange}
        onConfirm={(toSlotId) => {
          if (!changeFrom) return;
          changeM.mutate(
            { fromSlotId: changeFrom.id, toSlotId },
            { onSuccess: closeChange },
          );
        }}
        loading={changeM.isPending}
        error={changeM.isError ? (changeM.error as Error).message : null}
      />
    </div>
  );
}
