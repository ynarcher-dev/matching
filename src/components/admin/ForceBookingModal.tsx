import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Alert';
import { useForceAssign } from '@/hooks/useEventDetailMutations';
import { conflictingStartupIds } from '@/lib/booking';
import { participantLabel } from '@/lib/labels';
import { formatDateTime } from '@/lib/datetime';
import type { AssignableUser, MatchingSlotRow } from '@/types/eventDetail';

interface ForceBookingModalProps {
  open: boolean;
  onClose: () => void;
  eventId: string;
  /** 배정 대상 슬롯. */
  slot: MatchingSlotRow | null;
  /** 행사 전체 슬롯(동시간 충돌 판정). */
  allSlots: MatchingSlotRow[];
  /** 지정된 스타트업 사용자 목록. */
  startups: AssignableUser[];
  /** 표시용 부가정보. */
  expertName: string;
  timezone: string;
}

/**
 * 강제 배정 모달 (page_admin_event_detail.md §3.2).
 * 동시간 다른 예약을 가진 스타트업은 비활성(관리자도 우회 불가). 최대 상담 횟수만 DB 가 우회한다.
 * 사유 필수. 최종 중복 검증은 admin_force_assign RPC 가 트랜잭션에서 수행한다.
 */
export function ForceBookingModal({
  open,
  onClose,
  eventId,
  slot,
  allSlots,
  startups,
  expertName,
  timezone,
}: ForceBookingModalProps) {
  const [startupId, setStartupId] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const assign = useForceAssign(eventId);

  useEffect(() => {
    if (open) {
      setStartupId('');
      setReason('');
      setTouched(false);
    }
  }, [open, slot]);

  const conflicts = useMemo(
    () => (slot ? conflictingStartupIds(allSlots, slot) : new Set<string>()),
    [allSlots, slot],
  );

  const reasonInvalid = reason.trim().length === 0;
  const startupInvalid = startupId === '';

  const submit = () => {
    if (!slot || reasonInvalid || startupInvalid) {
      setTouched(true);
      return;
    }
    assign.mutate(
      { slotId: slot.id, startupId, reason: reason.trim() },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="강제 배정"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={assign.isPending}>
            취소
          </Button>
          <Button onClick={submit} loading={assign.isPending}>
            배정
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {slot && (
          <div className="rounded-lg border border-border bg-surface/40 px-3 py-2 text-sm text-neutral-base/80">
            <p>
              <span className="font-semibold text-neutral-base">전문가</span> {expertName}
            </p>
            <p>
              <span className="font-semibold text-neutral-base">시간</span>{' '}
              {formatDateTime(slot.start_time, timezone)} ~{' '}
              {formatDateTime(slot.end_time, timezone)}
            </p>
          </div>
        )}

        {assign.isError && <Alert tone="error">{(assign.error as Error).message}</Alert>}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="force-startup" className="text-sm font-semibold text-neutral-base">
            배정할 스타트업
          </label>
          <select
            id="force-startup"
            value={startupId}
            onChange={(e) => setStartupId(e.target.value)}
            className={`w-full rounded-lg border bg-white px-3 py-2 text-base text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30 ${
              touched && startupInvalid ? 'border-brand' : 'border-border'
            }`}
          >
            <option value="">스타트업을 선택하세요</option>
            {startups.map((u) => {
              const conflict = conflicts.has(u.id);
              return (
                <option key={u.id} value={u.id} disabled={conflict}>
                  {participantLabel(u)}
                  {conflict ? ' (동시간 예약 있음)' : ''}
                </option>
              );
            })}
          </select>
          {touched && startupInvalid && (
            <p className="text-sm font-medium text-brand">스타트업을 선택해 주세요.</p>
          )}
          <p className="text-xs text-neutral-base/60">
            동일 시간대에 다른 예약이 있는 스타트업은 선택할 수 없습니다.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="force-reason" className="text-sm font-semibold text-neutral-base">
            배정 사유
          </label>
          <textarea
            id="force-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            rows={3}
            placeholder="강제 배정 사유를 입력해 주세요(감사 로그 기록)."
            className={`w-full rounded-lg border bg-white px-3 py-2 text-base text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30 ${
              touched && reasonInvalid ? 'border-brand' : 'border-border'
            }`}
          />
          {touched && reasonInvalid && (
            <p className="text-sm font-medium text-brand">사유를 입력해 주세요.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
