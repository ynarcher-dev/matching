import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Alert';
import { conflictingStartupIds } from '@/lib/booking';
import { companyName, participantLabel } from '@/lib/labels';
import { formatDateTime } from '@/lib/datetime';
import type { AssignableUser, EventTable, MatchingSlotRow } from '@/types/eventDetail';

interface ReplaceNoShowModalProps {
  open: boolean;
  onClose: () => void;
  /** 대체 매칭 대상(NO_SHOW) 슬롯. */
  slot: MatchingSlotRow | null;
  /** 행사 전체 슬롯(동시간 충돌 판정용). */
  slots: MatchingSlotRow[];
  /** 지정된 스타트업 사용자 목록(현장 대기 후보). */
  startups: AssignableUser[];
  /** id → 사용자(전문가 이름·노쇼 기업 표시용). */
  userById: Map<string, AssignableUser>;
  tables: EventTable[];
  timezone: string;
  /** 대체 매칭 확정(상위가 replace_no_show 호출). */
  onConfirm: (startupId: string, reason: string) => void;
  loading: boolean;
  error: string | null;
}

/**
 * 노쇼 현장 대체 매칭 모달.
 */
export function ReplaceNoShowModal({
  open,
  onClose,
  slot,
  slots,
  startups,
  userById,
  tables,
  timezone,
  onConfirm,
  loading,
  error,
}: ReplaceNoShowModalProps) {
  const [startupId, setStartupId] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setStartupId('');
      setReason('');
      setTouched(false);
    }
  }, [open]);

  const expert = slot ? userById.get(slot.expert_id) : undefined;
  const prevStartup = slot?.startup_id ? userById.get(slot.startup_id) : undefined;
  const tableCode = useMemo(() => {
    if (!slot?.table_id) return null;
    return tables.find((t) => t.id === slot.table_id)?.table_code ?? null;
  }, [slot, tables]);

  // 대상 슬롯 시간과 겹치는 예약을 가진 스타트업(비활성).
  const conflicts = useMemo(
    () => (slot ? conflictingStartupIds(slots, slot) : new Set<string>()),
    [slots, slot],
  );

  // 현장 대기 후보: 참가 스타트업 전체(기업명 순). 충돌 대상은 옵션에서 비활성 처리한다.
  const options = useMemo(
    () =>
      [...startups].sort((a, b) => companyName(a).localeCompare(companyName(b), 'ko')),
    [startups],
  );

  const reasonInvalid = reason.trim().length === 0;
  const startupInvalid = startupId === '';

  const submit = () => {
    if (!slot || reasonInvalid || startupInvalid) {
      setTouched(true);
      return;
    }
    onConfirm(startupId, reason.trim());
  };

  const fieldClass = (invalid: boolean) =>
    `w-full rounded-lg border bg-white px-3 py-2 text-base text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:cursor-not-allowed disabled:bg-surface/60 ${
      touched && invalid ? 'border-brand' : 'border-border'
    }`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="노쇼 현장 대체 매칭"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            취소
          </Button>
          <Button onClick={submit} loading={loading}>
            대체 매칭
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alert tone="error">{error}</Alert>}

        {/* 대상 슬롯 컨텍스트 */}
        {slot && (
          <div className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-neutral-base">
            <p className="font-semibold">
              {expert ? participantLabel(expert) : '(알 수 없는 전문가)'}
              {tableCode ? ` · ${tableCode}` : ''}
            </p>
            <p className="text-xs text-neutral-base/70">
              {formatDateTime(slot.start_time, timezone)} ~ {formatDateTime(slot.end_time, timezone).slice(-5)}
            </p>
            {prevStartup && (
              <p className="mt-1 text-xs text-danger">노쇼: {companyName(prevStartup)}</p>
            )}
          </div>
        )}

        {/* 대체 스타트업 선택 */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="replace-startup" className="text-sm font-semibold text-neutral-base">
            대체 매칭할 스타트업(현장 대기)
          </label>
          <select
            id="replace-startup"
            value={startupId}
            onChange={(e) => setStartupId(e.target.value)}
            className={fieldClass(startupInvalid)}
          >
            <option value="">스타트업을 선택하세요</option>
            {options.map((u) => {
              const conflict = conflicts.has(u.id);
              return (
                <option
                  key={u.id}
                  value={u.id}
                  disabled={conflict}
                  className={conflict ? 'text-danger line-through' : undefined}
                >
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
            동일 시간대에 이미 예약이 있는 스타트업은 대체 매칭할 수 없습니다.
          </p>
        </div>

        {/* 사유(필수) */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="replace-reason" className="text-sm font-semibold text-neutral-base">
            대체 매칭 사유
          </label>
          <textarea
            id="replace-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            rows={3}
            placeholder="현장 대체 매칭 사유를 입력해 주세요(감사 로그 기록)."
            className={fieldClass(reasonInvalid)}
          />
          {touched && reasonInvalid && (
            <p className="text-sm font-medium text-brand">사유를 입력해 주세요.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
