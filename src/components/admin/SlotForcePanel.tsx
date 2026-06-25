import { useMemo, useState } from 'react';
import { Card } from '@/components/common/Card';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { ForceBookingModal } from '@/components/admin/ForceBookingModal';
import { useForceCancel } from '@/hooks/useEventDetailMutations';
import { formatDateTime } from '@/lib/datetime';
import { participantLabel, BOOKING_TYPE_LABELS, SESSION_STATUS_LABELS } from '@/lib/labels';
import type {
  AssignableUser,
  BookingType,
  EventParticipantRow,
  EventTable,
  MatchingSlotRow,
} from '@/types/eventDetail';

interface SlotForcePanelProps {
  eventId: string;
  slots: MatchingSlotRow[];
  participants: EventParticipantRow[];
  tables: EventTable[];
  userById: Map<string, AssignableUser>;
  timezone: string;
  locked: boolean;
}

/** 예약 경로 배지 색상. */
const TYPE_TONE: Record<BookingType, string> = {
  NONE: 'bg-surface text-neutral-base/60',
  MANUAL: 'bg-info-surface text-neutral-base',
  AUTO_AI: 'bg-muted text-neutral-base',
  ADMIN_FORCE: 'bg-danger-surface text-brand',
};

/**
 * 강제 조정 패널 (page_admin_event_detail.md §3.2).
 * 슬롯 목록에서 빈 슬롯은 강제 배정, 예약된 슬롯은 강제 취소한다(사유 필수·감사 로그).
 * 실시간 타임그리드 시각화는 슬롯 자동 생성과 함께 다음 단계에서 확장한다.
 */
export function SlotForcePanel({
  eventId,
  slots,
  participants,
  tables,
  userById,
  timezone,
  locked,
}: SlotForcePanelProps) {
  const [assignTarget, setAssignTarget] = useState<MatchingSlotRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<MatchingSlotRow | null>(null);
  const cancel = useForceCancel(eventId);

  const tableCodeById = useMemo(
    () => new Map(tables.map((t) => [t.id, t.table_code])),
    [tables],
  );
  const startups = useMemo(
    () =>
      participants
        .filter((p) => p.participant_type === 'STARTUP')
        .map((p) => userById.get(p.user_id))
        .filter((u): u is AssignableUser => Boolean(u)),
    [participants, userById],
  );

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="text-lg font-bold text-neutral-base">강제 조정</h2>

      {slots.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-neutral-base/60">
          매칭 슬롯이 없습니다. 배치 단계에서 시간표 슬롯을 생성한 뒤 강제 조정할 수 있습니다.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-surface text-neutral-base/80">
                <Th>시간</Th>
                <Th>전문가</Th>
                <Th>테이블</Th>
                <Th>스타트업</Th>
                <Th>경로</Th>
                <Th>상태</Th>
                {!locked && <Th>조작</Th>}
              </tr>
            </thead>
            <tbody>
              {slots.map((s) => {
                const expert = userById.get(s.expert_id);
                const startup = s.startup_id ? userById.get(s.startup_id) : null;
                const booked = Boolean(s.startup_id) && s.session_status !== 'CANCELLED';
                return (
                  <tr
                    key={s.id}
                    className="border-b border-border last:border-b-0 hover:bg-surface/60"
                  >
                    <Td className="whitespace-nowrap text-neutral-base/80">
                      {formatDateTime(s.start_time, timezone)}
                    </Td>
                    <Td className="font-medium text-neutral-base">
                      {expert ? participantLabel(expert) : '-'}
                    </Td>
                    <Td className="text-neutral-base/70">
                      {s.table_id ? (tableCodeById.get(s.table_id) ?? '-') : '기본'}
                    </Td>
                    <Td>
                      {startup ? (
                        participantLabel(startup)
                      ) : (
                        <span className="text-neutral-base/50">빈 슬롯</span>
                      )}
                    </Td>
                    <Td>
                      <span
                        className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_TONE[s.booking_type]}`}
                      >
                        {BOOKING_TYPE_LABELS[s.booking_type]}
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap text-neutral-base/70">
                      {SESSION_STATUS_LABELS[s.session_status]}
                    </Td>
                    {!locked && (
                      <Td>
                        {booked ? (
                          <RowAction danger onClick={() => setCancelTarget(s)}>
                            강제 취소
                          </RowAction>
                        ) : (
                          <RowAction onClick={() => setAssignTarget(s)}>강제 배정</RowAction>
                        )}
                      </Td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ForceBookingModal
        open={assignTarget !== null}
        onClose={() => setAssignTarget(null)}
        eventId={eventId}
        slot={assignTarget}
        allSlots={slots}
        startups={startups}
        expertName={
          assignTarget
            ? (userById.get(assignTarget.expert_id)
                ? participantLabel(userById.get(assignTarget.expert_id)!)
                : '-')
            : '-'
        }
        timezone={timezone}
      />

      <ConfirmModal
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title="강제 취소"
        message="이 슬롯의 예약을 강제로 취소하고 슬롯을 다시 공개합니다. 사유는 감사 로그에 기록됩니다."
        confirmLabel="강제 취소"
        requireReason
        reasonLabel="취소 사유"
        loading={cancel.isPending}
        error={cancel.isError ? (cancel.error as Error).message : null}
        onConfirm={(reason) => {
          if (cancelTarget) {
            cancel.mutate(
              { slotId: cancelTarget.id, reason },
              { onSuccess: () => setCancelTarget(null) },
            );
          }
        }}
      />
    </Card>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2.5 font-semibold">{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 align-middle ${className}`}>{children}</td>;
}

function RowAction({
  children,
  onClick,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap rounded-md border px-2 py-1 text-xs font-semibold transition-colors ${
        danger
          ? 'border-border text-brand hover:bg-danger-surface'
          : 'border-border text-neutral-base hover:bg-surface'
      }`}
    >
      {children}
    </button>
  );
}
