import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Alert';
import { cancelEventSchema } from '@/schemas/eventSchemas';
import type { CancelEventValues } from '@/schemas/eventSchemas';
import { useCancelEvent } from '@/hooks/useEventMutations';
import type { EventWithCounts } from '@/types/event';

interface CancelEventModalProps {
  open: boolean;
  onClose: () => void;
  event: EventWithCounts | null;
}

/**
 * 행사 취소 확인 모달 (page_admin_event_list.md §2.2).
 * 물리 삭제가 아닌 CANCELLED 상태 전이이며 사유가 필수다(override RPC·감사 로그).
 */
export function CancelEventModal({ open, onClose, event }: CancelEventModalProps) {
  const cancel = useCancelEvent();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CancelEventValues>({
    resolver: zodResolver(cancelEventSchema),
    defaultValues: { reason: '' },
  });

  useEffect(() => {
    if (open) reset({ reason: '' });
  }, [open, reset]);

  const onSubmit = handleSubmit((values) => {
    if (!event) return;
    cancel.mutate({ id: event.id, reason: values.reason }, { onSuccess: () => onClose() });
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="행사 취소"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={cancel.isPending}>
            돌아가기
          </Button>
          <Button type="submit" form="cancel-event-form" loading={cancel.isPending}>
            행사 취소 확정
          </Button>
        </>
      }
    >
      <form id="cancel-event-form" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Alert tone="error">
          <span className="font-semibold">{event?.title}</span> 행사를 취소합니다. 취소된 행사는
          목록의 ‘취소’ 필터에서만 조회되며, 자동 상태 전환이 더 이상 적용되지 않습니다.
        </Alert>
        {cancel.error && <Alert tone="error">{(cancel.error as Error).message}</Alert>}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cancel-reason" className="text-sm font-semibold text-neutral-base">
            취소 사유 (필수)
          </label>
          <textarea
            id="cancel-reason"
            rows={3}
            placeholder="감사 로그에 기록됩니다."
            className={`w-full rounded-lg border bg-white px-3 py-2 text-base text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30 ${
              errors.reason ? 'border-brand' : 'border-border'
            }`}
            {...register('reason')}
          />
          {errors.reason && (
            <p className="text-sm font-medium text-brand">{errors.reason.message}</p>
          )}
        </div>
      </form>
    </Modal>
  );
}
