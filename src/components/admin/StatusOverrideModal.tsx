import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Alert';
import { SelectField } from '@/components/common/SelectField';
import { statusOverrideSchema, MANUAL_STATUSES } from '@/schemas/eventSchemas';
import type { StatusOverrideValues } from '@/schemas/eventSchemas';
import { useOverrideEventStatus } from '@/hooks/useEventMutations';
import { EVENT_STATUS_LABELS } from '@/lib/labels';
import type { EventRow, EventStatus } from '@/types/event';

interface StatusOverrideModalProps {
  open: boolean;
  onClose: () => void;
  event: EventRow | null;
}

const STATUS_OPTIONS = MANUAL_STATUSES.map((s) => ({
  value: s,
  label: EVENT_STATUS_LABELS[s],
}));

/** 현재 상태가 수동 전환 대상 밖(CANCELLED)이면 기본값을 DRAFT 로 둔다. */
function initialStatus(status: EventStatus | undefined): (typeof MANUAL_STATUSES)[number] {
  return status && (MANUAL_STATUSES as readonly string[]).includes(status)
    ? (status as (typeof MANUAL_STATUSES)[number])
    : 'DRAFT';
}

/**
 * 행사 상태 수동 변경 모달 (page_admin_event_list.md §2.2) — 최고 관리자 전용.
 * 일정 기반 자동 전환을 멈추고 지정 상태로 '고정'하므로, 확정 전 경고와 사유 입력을 받는다.
 * 취소(CANCELLED)로의 전환은 별도 취소 흐름(CancelEventModal)에서 처리한다.
 */
export function StatusOverrideModal({ open, onClose, event }: StatusOverrideModalProps) {
  const override = useOverrideEventStatus();
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<StatusOverrideValues>({
    resolver: zodResolver(statusOverrideSchema),
    defaultValues: { status: 'DRAFT', reason: '' },
  });

  useEffect(() => {
    if (open) reset({ status: initialStatus(event?.status), reason: '' });
  }, [open, event, reset]);

  const selected = watch('status');
  const isSameStatus = event?.status === selected;

  const onSubmit = handleSubmit((values) => {
    if (!event) return;
    override.mutate(
      { id: event.id, status: values.status, reason: values.reason },
      { onSuccess: () => onClose() },
    );
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="행사 상태 수동 변경"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={override.isPending}>
            돌아가기
          </Button>
          <Button type="submit" form="status-override-form" loading={override.isPending}>
            상태 변경 확정
          </Button>
        </>
      }
    >
      <form id="status-override-form" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Alert tone="error">
          상태를 수동으로 변경하면 <span className="font-semibold">일정 기반 자동 전환이
          멈추고</span> 선택한 상태로 고정됩니다. 이후 예약·행사 시간이 지나도 상태가 바뀌지
          않으니, 자동 전환을 다시 쓰려면 ‘자동 전환 재개’로 고정을 풀어 주세요.
        </Alert>

        <p className="text-sm text-neutral-base/80">
          현재 상태:{' '}
          <span className="font-semibold text-neutral-base">
            {event ? EVENT_STATUS_LABELS[event.status] : '-'}
          </span>
          {event?.status_override && (
            <span className="text-neutral-base/60"> (이미 고정됨)</span>
          )}
        </p>

        <SelectField
          label="변경할 상태"
          options={STATUS_OPTIONS}
          error={errors.status?.message}
          {...register('status')}
        />

        {isSameStatus && (
          <Alert tone="info">
            현재 상태와 동일합니다. 확정하면 상태값은 그대로 두고 ‘고정’만 적용됩니다.
          </Alert>
        )}

        {override.error && <Alert tone="error">{(override.error as Error).message}</Alert>}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="status-override-reason" className="text-sm font-semibold text-neutral-base">
            변경 사유 (필수)
          </label>
          <textarea
            id="status-override-reason"
            rows={3}
            placeholder="감사 로그에 기록됩니다."
            className={`w-full rounded-lg border bg-white px-3 py-2 text-base text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30 ${
              errors.reason ? 'border-brand' : 'border-border'
            }`}
            {...register('reason')}
          />
          {errors.reason && <p className="text-sm font-medium text-brand">{errors.reason.message}</p>}
        </div>
      </form>
    </Modal>
  );
}
