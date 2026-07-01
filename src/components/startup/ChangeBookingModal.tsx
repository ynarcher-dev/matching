import { useMemo, useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { formatDateTime, formatRange } from '@/lib/datetime';
import { bookingBlockReason, isAvailable } from '@/lib/startupBooking';
import type { MatchingSlotRow } from '@/types/eventDetail';
import type { PortalExpert } from '@/types/startupBooking';

interface ChangeBookingModalProps {
  open: boolean;
  /** 변경 대상(기존 예약) 슬롯. */
  fromSlot: MatchingSlotRow | null;
  slots: MatchingSlotRow[];
  expertById: Map<string, PortalExpert>;
  myId: string;
  maxSessions: number;
  /** 행사 설정: 동일 전문가 2회 이상 예약 허용. */
  allowDuplicateExpert: boolean;
  timezone: string;
  onClose: () => void;
  onConfirm: (toSlotId: string) => void;
  loading: boolean;
}

/**
 * 예약 시간 변경 (page_startup_booking.md §2.2).
 * 별도 Hold 없이 변경 가능 슬롯 목록을 보여주고, 선택 후 기존 해제+신규 예약을
 * 단일 RPC 트랜잭션으로 처리한다. 기존 슬롯은 검증에서 제외(excludeSlotId).
 */
export function ChangeBookingModal({
  open,
  fromSlot,
  slots,
  expertById,
  myId,
  maxSessions,
  allowDuplicateExpert,
  timezone,
  onClose,
  onConfirm,
  loading,
}: ChangeBookingModalProps) {
  const [selected, setSelected] = useState<string | null>(null);

  // 변경 가능 후보: 빈 슬롯 + 기존 슬롯 제외 사전검증 통과(자기 자신 제외).
  const candidates = useMemo(() => {
    if (!fromSlot) return [] as MatchingSlotRow[];
    return slots
      .filter(
        (s) =>
          s.id !== fromSlot.id &&
          isAvailable(s) &&
          !bookingBlockReason(slots, s, myId, maxSessions, {
            excludeSlotId: fromSlot.id,
            allowDuplicateExpert,
          }),
      )
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }, [fromSlot, slots, myId, maxSessions, allowDuplicateExpert]);

  const handleConfirm = () => {
    if (selected) onConfirm(selected);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="예약 시간 변경"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            닫기
          </Button>
          <Button onClick={handleConfirm} loading={loading} disabled={!selected}>
            이 시간으로 변경
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {fromSlot && (
          <p className="text-sm text-neutral-base">
            현재 예약:{' '}
            <span className="font-bold">
              {formatRange(fromSlot.start_time, fromSlot.end_time, timezone)}
            </span>{' '}
            ({expertById.get(fromSlot.expert_id)?.name ?? '전문가'})
          </p>
        )}

        {candidates.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-neutral-base/60">
            변경 가능한 시간이 없습니다. 다른 기업이 취소하면 표시됩니다.
          </p>
        ) : (
          <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
            {candidates.map((slot) => {
              const expert = expertById.get(slot.expert_id);
              const active = selected === slot.id;
              return (
                <li key={slot.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(slot.id)}
                    className={`flex w-full flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                      active
                        ? 'border-brand bg-danger-surface'
                        : 'border-border bg-white hover:bg-surface'
                    }`}
                  >
                    <span className="text-sm font-bold text-neutral-base">
                      {formatDateTime(slot.start_time, timezone)} ~{' '}
                      {formatDateTime(slot.end_time, timezone).slice(-5)}
                    </span>
                    <span className="text-sm text-neutral-base">
                      {expert?.name ?? '전문가'}
                      {expert?.organization ? ` · ${expert.organization}` : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
