import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { TextField } from '@/components/common/TextField';
import { SelectField } from '@/components/common/SelectField';
import { Alert } from '@/components/common/Alert';
import { eventFormSchema } from '@/schemas/eventSchemas';
import type { EventFormValues } from '@/schemas/eventSchemas';
import { useCreateEvent, useUpdateEvent } from '@/hooks/useEventMutations';
import { TIMEZONE_OPTIONS, isoToLocalInput } from '@/lib/datetime';
import type { EventWithCounts } from '@/types/event';

interface EventFormModalProps {
  open: boolean;
  onClose: () => void;
  /** 지정 시 편집 모드, 미지정 시 신규 개설 모드. */
  event?: EventWithCounts | null;
}

const DEFAULT_TZ = 'Asia/Seoul';

function buildDefaults(event?: EventWithCounts | null): EventFormValues {
  if (!event) {
    return {
      title: '',
      max_sessions_per_startup: 3,
      timezone: DEFAULT_TZ,
      allow_startup_self_booking: false,
      allow_duplicate_expert: false,
      booking_start: '',
      booking_end: '',
      event_start: '',
      event_end: '',
    };
  }
  const tz = event.timezone;
  return {
    title: event.title,
    max_sessions_per_startup: event.max_sessions_per_startup,
    timezone: tz,
    allow_startup_self_booking: event.allow_startup_self_booking,
    allow_duplicate_expert: event.allow_duplicate_expert,
    booking_start: isoToLocalInput(event.booking_start, tz),
    booking_end: isoToLocalInput(event.booking_end, tz),
    event_start: isoToLocalInput(event.event_start, tz),
    event_end: isoToLocalInput(event.event_end, tz),
  };
}

/**
 * 행사 개설/편집 폼 (page_admin_event_list.md §2.1).
 * 날짜는 행사 timezone 벽시계로 입력받아 제출 시 UTC 로 변환한다.
 */
export function EventFormModal({ open, onClose, event }: EventFormModalProps) {
  const isEdit = Boolean(event);
  const create = useCreateEvent();
  const update = useUpdateEvent();
  const pending = create.isPending || update.isPending;
  const submitError = create.error ?? update.error;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: buildDefaults(event),
  });

  // 모달이 열릴 때마다 대상 행사에 맞춰 폼을 초기화한다.
  useEffect(() => {
    if (open) reset(buildDefaults(event));
  }, [open, event, reset]);

  const onSubmit = handleSubmit((values) => {
    const onDone = { onSuccess: () => onClose() };
    if (isEdit && event) {
      update.mutate({ id: event.id, values }, onDone);
    } else {
      create.mutate(values, onDone);
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? '행사 편집' : '새 행사 개설'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            취소
          </Button>
          <Button type="submit" form="event-form" loading={pending}>
            {isEdit ? '저장' : '개설'}
          </Button>
        </>
      }
    >
      <form id="event-form" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {submitError && <Alert tone="error">{(submitError as Error).message}</Alert>}

        <TextField
          label="행사명"
          placeholder="예: 2026 상반기 비즈니스 매칭 데이"
          error={errors.title?.message}
          {...register('title')}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="스타트업당 최대 상담 횟수"
            type="number"
            min={1}
            error={errors.max_sessions_per_startup?.message}
            {...register('max_sessions_per_startup')}
          />
          <SelectField
            label="시간대"
            options={TIMEZONE_OPTIONS}
            error={errors.timezone?.message}
            {...register('timezone')}
          />
        </div>

        <fieldset className="grid grid-cols-1 gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold text-neutral-base">예약 기간</legend>
          <TextField
            label="예약 시작"
            type="datetime-local"
            error={errors.booking_start?.message}
            {...register('booking_start')}
          />
          <TextField
            label="예약 마감"
            type="datetime-local"
            error={errors.booking_end?.message}
            {...register('booking_end')}
          />
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold text-neutral-base">행사 진행 기간</legend>
          <TextField
            label="행사 시작"
            type="datetime-local"
            error={errors.event_start?.message}
            {...register('event_start')}
          />
          <TextField
            label="행사 종료"
            type="datetime-local"
            error={errors.event_end?.message}
            {...register('event_end')}
          />
        </fieldset>

        <label className="flex items-center gap-2 text-sm font-medium text-neutral-base">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border text-brand focus:ring-brand/30"
            {...register('allow_startup_self_booking')}
          />
          배치 조율·진행 단계에서도 스타트업 자율 예약(변경·취소) 허용
        </label>

        <label className="flex items-center gap-2 text-sm font-medium text-neutral-base">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border text-brand focus:ring-brand/30"
            {...register('allow_duplicate_expert')}
          />
          동일 전문가와 2회 이상(연속 시간 등) 예약 허용
        </label>
      </form>
    </Modal>
  );
}
