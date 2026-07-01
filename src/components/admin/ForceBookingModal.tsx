import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Alert';
import { useForceAssign } from '@/hooks/useEventDetailMutations';
import { conflictingSlotIdsForStartup } from '@/lib/booking';
import { participantLabel } from '@/lib/labels';
import { formatDateTime } from '@/lib/datetime';
import type { AssignableUser, EventTable, MatchingSlotRow } from '@/types/eventDetail';

interface ForceBookingModalProps {
  open: boolean;
  onClose: () => void;
  eventId: string;
  /** 행사 전체 슬롯(빈 슬롯 후보 + 동시간 충돌 판정). */
  slots: MatchingSlotRow[];
  /** 지정된 스타트업 사용자 목록. */
  startups: AssignableUser[];
  /** id → 사용자(전문가 이름 표시용). */
  userById: Map<string, AssignableUser>;
  /** 테이블 코드 표시용. */
  tables: EventTable[];
  timezone: string;
  /** 배치 현황 표에서 빈 슬롯을 클릭해 연 경우, 그 슬롯을 미리 선택한다. */
  initialSlotId?: string | null;
  /** 기업별 배치 현황에서 특정 기업의 + 배정으로 연 경우, 그 스타트업을 미리 선택한다. */
  initialStartupId?: string | null;
}

/** 전문가 표시 라벨(이름 · 소속). 알 수 없으면 안내 문구. */
function expertLabel(userById: Map<string, AssignableUser>, expertId: string): string {
  const u = userById.get(expertId);
  return u ? participantLabel(u) : '(알 수 없는 전문가)';
}

/**
 * 강제 배정 모달 (page_admin_event_detail.md §3.2).
 * 기준은 "스타트업에게 전문가를 배정" — 먼저 스타트업을 고른 뒤, 비어 있는 전문가 슬롯을 선택한다.
 * 선택한 스타트업이 이미 예약한 시간대와 겹치는 슬롯은 비활성(관리자도 우회 불가).
 * 사유 필수. 최종 중복 검증은 admin_force_assign RPC 가 트랜잭션에서 수행한다.
 */
export function ForceBookingModal({
  open,
  onClose,
  eventId,
  slots,
  startups,
  userById,
  tables,
  timezone,
  initialSlotId,
  initialStartupId,
}: ForceBookingModalProps) {
  const [startupId, setStartupId] = useState('');
  // 전문가 → 시간 2단 선택. 전문가를 고르면 그 전문가의 빈 시간만 시간 셀렉트에 노출한다.
  const [expertId, setExpertId] = useState('');
  const [slotId, setSlotId] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const assign = useForceAssign(eventId);

  useEffect(() => {
    if (open) {
      setStartupId(initialStartupId ?? '');
      // 빈 슬롯 클릭으로 연 경우(initialSlotId), 그 슬롯의 전문가/시간을 미리 선택.
      const initSlot = initialSlotId ? slots.find((s) => s.id === initialSlotId) : undefined;
      setExpertId(initSlot?.expert_id ?? '');
      setSlotId(initialSlotId ?? '');
      setReason('');
      setTouched(false);
    }
  }, [open, initialSlotId, initialStartupId, slots]);

  const tableCodeById = useMemo(() => new Map(tables.map((t) => [t.id, t.table_code])), [tables]);

  // 배정할 스타트업 셀렉트 — 표시 라벨(기업명 · 대표명) 이름순.
  const sortedStartups = useMemo(
    () => [...startups].sort((a, b) => participantLabel(a).localeCompare(participantLabel(b), 'ko')),
    [startups],
  );

  // 비어 있는(배정 가능) 슬롯 — 시작시각 → 전문가명 순.
  const emptySlots = useMemo(() => {
    return slots
      .filter((s) => s.startup_id === null)
      .sort(
        (a, b) =>
          a.start_time.localeCompare(b.start_time) ||
          expertLabel(userById, a.expert_id).localeCompare(
            expertLabel(userById, b.expert_id),
            'ko',
          ),
      );
  }, [slots, userById]);

  // 빈 슬롯이 있는 전문가 목록(이름 순) — 전문가 셀렉트.
  const expertOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const s of emptySlots) ids.add(s.expert_id);
    return [...ids]
      .map((id) => ({ id, label: expertLabel(userById, id) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  }, [emptySlots, userById]);

  // 선택한 전문가의 빈 시간 슬롯(시작시각 순) — 시간 셀렉트.
  const timeSlots = useMemo(
    () => (expertId ? emptySlots.filter((s) => s.expert_id === expertId) : []),
    [emptySlots, expertId],
  );

  // 선택한 스타트업과 시간이 겹쳐 배정 불가한 빈 슬롯.
  const conflicts = useMemo(
    () => (startupId ? conflictingSlotIdsForStartup(slots, startupId) : new Set<string>()),
    [slots, startupId],
  );

  // 스타트업을 바꿔 선택 슬롯이 충돌 대상이 되면 선택 해제.
  useEffect(() => {
    if (slotId && conflicts.has(slotId)) setSlotId('');
  }, [conflicts, slotId]);

  const reasonInvalid = reason.trim().length === 0;
  const startupInvalid = startupId === '';
  const expertInvalid = expertId === '';
  const slotInvalid = slotId === '';

  // 전문가 변경 시 시간 선택 초기화.
  const onExpertChange = (id: string) => {
    setExpertId(id);
    setSlotId('');
  };

  const submit = () => {
    if (reasonInvalid || startupInvalid || expertInvalid || slotInvalid) {
      setTouched(true);
      return;
    }
    assign.mutate({ slotId, startupId, reason: reason.trim() }, { onSuccess: onClose });
  };

  const fieldClass = (invalid: boolean) =>
    `h-9 w-full rounded-lg border bg-white px-3 text-sm text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:cursor-not-allowed disabled:bg-surface/60 ${
      touched && invalid ? 'border-brand' : 'border-border'
    }`;

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
        {assign.isError && <Alert tone="error">{(assign.error as Error).message}</Alert>}

        {/* 1) 스타트업 선택(기준) */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="force-startup" className="text-sm font-semibold text-neutral-base">
            배정할 스타트업
          </label>
          <select
            id="force-startup"
            value={startupId}
            onChange={(e) => setStartupId(e.target.value)}
            className={fieldClass(startupInvalid)}
          >
            <option value="">스타트업을 선택하세요</option>
            {sortedStartups.map((u) => (
              <option key={u.id} value={u.id}>
                {participantLabel(u)}
              </option>
            ))}
          </select>
          {touched && startupInvalid && (
            <p className="text-sm font-medium text-brand">스타트업을 선택해 주세요.</p>
          )}
        </div>

        {/* 2) 전문가 선택(스타트업에게 배정할 전문가) */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="force-expert" className="text-sm font-semibold text-neutral-base">
            배정할 전문가
          </label>
          <select
            id="force-expert"
            value={expertId}
            disabled={!startupId}
            onChange={(e) => onExpertChange(e.target.value)}
            className={fieldClass(expertInvalid)}
          >
            <option value="">
              {startupId ? '전문가를 선택하세요' : '먼저 스타트업을 선택하세요'}
            </option>
            {expertOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {touched && expertInvalid && (
            <p className="text-sm font-medium text-brand">전문가를 선택해 주세요.</p>
          )}
          {startupId && expertOptions.length === 0 && (
            <p className="text-sm font-medium text-brand">배정할 수 있는 빈 슬롯이 없습니다.</p>
          )}
        </div>

        {/* 3) 시간 선택(선택한 전문가의 빈 슬롯) */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="force-slot" className="text-sm font-semibold text-neutral-base">
            배정할 시간
          </label>
          <select
            id="force-slot"
            value={slotId}
            disabled={!expertId}
            onChange={(e) => setSlotId(e.target.value)}
            className={fieldClass(slotInvalid)}
          >
            <option value="">{expertId ? '시간을 선택하세요' : '먼저 전문가를 선택하세요'}</option>
            {timeSlots.map((s) => {
              const conflict = conflicts.has(s.id);
              const table = s.table_id ? tableCodeById.get(s.table_id) : null;
              return (
                <option
                  key={s.id}
                  value={s.id}
                  disabled={conflict}
                  className={conflict ? 'text-danger line-through' : undefined}
                >
                  {formatDateTime(s.start_time, timezone)}
                  {table ? ` · ${table}` : ''}
                  {conflict ? ' (동시간 예약 있음)' : ''}
                </option>
              );
            })}
          </select>
          {touched && slotInvalid && (
            <p className="text-sm font-medium text-brand">시간을 선택해 주세요.</p>
          )}
          <p className="text-xs text-neutral-base/60">
            동일 시간대에 이미 예약이 있는 스타트업은 해당 시간 슬롯에 배정할 수 없습니다.
          </p>
        </div>

        {/* 4) 사유(필수) */}
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
