import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { StatusBanner } from '@/components/common/StatusBanner';
import { Button } from '@/components/common/Button';
import { toast } from '@/stores/toastStore';
import {
  useEventNotificationSettings,
  useGlobalNotificationSettings,
  useUpsertEventNotificationSettings,
} from '@/hooks/useNotificationSettings';
import { canDispatchExternally, getDispatchMode } from '@/lib/notificationGate';
import { eventNotificationSettingsSchema } from '@/schemas/notificationSettingsSchemas';
import {
  NOTIFICATION_POLICY_LABELS,
  DISPATCH_MODE_LABELS,
  NOTIFICATION_TYPE_LABELS,
} from '@/lib/labels';
import type { EventNotificationSettingsInput } from '@/schemas/notificationSettingsSchemas';
import type { EventToggleItem } from '@/types/notificationSettings';

const POLICY_OPTIONS = ['NONE', 'ALIMTALK', 'SMS', 'ALIMTALK_SMS'] as const;

const EVENT_TOGGLES: EventToggleItem[] = [
  { key: 'send_booking_open',      label: NOTIFICATION_TYPE_LABELS['EVENT_BOOKING_OPEN'] ?? '예약 시작 안내' },
  { key: 'send_booking_created',   label: NOTIFICATION_TYPE_LABELS['BOOKING_CREATED'] ?? '예약 확정' },
  { key: 'send_booking_changed',   label: NOTIFICATION_TYPE_LABELS['BOOKING_CHANGED'] ?? '예약 변경' },
  { key: 'send_booking_cancelled', label: NOTIFICATION_TYPE_LABELS['BOOKING_CANCELLED'] ?? '예약 취소' },
  { key: 'send_unbooked_reminder', label: '미예약 스타트업 리마인드' },
  { key: 'send_event_reminder',    label: '행사 전 리마인드' },
];

const DEFAULT_VALUES: EventNotificationSettingsInput = {
  notification_policy: 'NONE',
  send_booking_open: false,
  send_booking_created: false,
  send_booking_changed: false,
  send_booking_cancelled: false,
  send_unbooked_reminder: false,
  send_event_reminder: false,
};

interface Props {
  eventId: string;
}

/**
 * 행사별 알림 채널 정책 + 이벤트 토글 설정 패널 (page_admin_notification_settings.md §3.2).
 * 전역 설정 상태를 읽기 전용으로 표시하고 행사별 정책을 편집한다.
 */
export function EventNotificationSettingsPanel({ eventId }: Props) {
  const globalQ  = useGlobalNotificationSettings();
  const settingQ = useEventNotificationSettings(eventId);
  const upsert   = useUpsertEventNotificationSettings(eventId);

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    formState: { isDirty, isSubmitting },
  } = useForm<EventNotificationSettingsInput>({
    resolver: zodResolver(eventNotificationSettingsSchema),
    defaultValues: DEFAULT_VALUES,
  });

  // 서버 데이터 로드 후 폼 초기화
  useEffect(() => {
    if (settingQ.data) {
      reset({
        notification_policy:    settingQ.data.notification_policy,
        send_booking_open:      settingQ.data.send_booking_open,
        send_booking_created:   settingQ.data.send_booking_created,
        send_booking_changed:   settingQ.data.send_booking_changed,
        send_booking_cancelled: settingQ.data.send_booking_cancelled,
        send_unbooked_reminder: settingQ.data.send_unbooked_reminder,
        send_event_reminder:    settingQ.data.send_event_reminder,
      });
    } else if (!settingQ.isLoading) {
      reset(DEFAULT_VALUES);
    }
  }, [settingQ.data, settingQ.isLoading, reset]);

  const globalSettings = globalQ.data ?? null;
  const dispatchMode   = getDispatchMode(globalSettings);
  const modeMeta       = DISPATCH_MODE_LABELS[dispatchMode];

  const policy = watch('notification_policy');
  const togglesDisabled = policy === 'NONE';

  // 현재 폼 값으로 게이트 미리보기
  const gatePreview = canDispatchExternally(globalSettings, {
    event_id: eventId,
    notification_policy: policy,
    template_set_id: null,
    send_booking_open: watch('send_booking_open'),
    send_booking_created: watch('send_booking_created'),
    send_booking_changed: watch('send_booking_changed'),
    send_booking_cancelled: watch('send_booking_cancelled'),
    send_unbooked_reminder: watch('send_unbooked_reminder'),
    send_event_reminder: watch('send_event_reminder'),
    updated_by: null,
    updated_at: '',
  }, 'BOOKING_CREATED');

  const onSubmit = async (values: EventNotificationSettingsInput) => {
    try {
      await upsert.mutateAsync(values);
      toast.success('행사 알림 정책을 저장했습니다.');
    } catch (e) {
      toast.error('저장하지 못했습니다.', { description: (e as Error).message });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 전역 설정 상태 (읽기 전용) */}
      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold text-neutral-base">전역 발송 설정 상태</h3>
          <Link
            to="/admin/settings"
            className="text-xs font-semibold text-brand underline underline-offset-2"
          >
            설정 변경 →
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${modeMeta.className}`}
          >
            {modeMeta.label}
          </span>
          {globalSettings && (
            <span className="text-xs text-neutral-base/60">
              공급사: {globalSettings.provider === 'MOCK' ? 'Mock' : 'Solapi'} ·{' '}
              실발송: {globalSettings.dispatch_enabled ? 'ON' : 'OFF'}
            </span>
          )}
        </div>

        {dispatchMode === 'FREE_OPERATION' && (
          <StatusBanner
            tone="warning"
            label="전역 발송 비활성"
            detail="행사별 정책을 설정해 두면 전역 발송 활성화 시 즉시 적용됩니다."
          />
        )}
      </Card>

      {/* 행사별 정책 폼 */}
      <Card className="flex flex-col gap-5 p-5">
        <h2 className="text-lg font-bold text-neutral-base">행사 알림 정책</h2>

        {settingQ.isError && (
          <Alert tone="error">설정을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</Alert>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
          {/* 채널 정책 */}
          <section className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-neutral-base">알림 채널 정책</p>
            <p className="text-xs text-neutral-base/60">
              기본값은 <strong>발송 안 함</strong>입니다. 전역 발송 비활성 상태에서도 미리 설정할 수 있습니다.
            </p>
            <div className="flex flex-col gap-2">
              {POLICY_OPTIONS.map((p) => (
                <label key={p} className="flex cursor-pointer items-center gap-2.5">
                  <input
                    type="radio"
                    value={p}
                    {...register('notification_policy')}
                    className="accent-brand"
                  />
                  <span className="text-sm text-neutral-base">
                    {NOTIFICATION_POLICY_LABELS[p]}
                  </span>
                </label>
              ))}
            </div>
          </section>

          {/* 이벤트별 토글 */}
          <section className="flex flex-col gap-2">
            <p className={`text-sm font-semibold ${togglesDisabled ? 'text-neutral-base/40' : 'text-neutral-base'}`}>
              이벤트별 발송 ON/OFF
            </p>
            {togglesDisabled && (
              <p className="text-xs text-neutral-base/50">채널 정책을 선택하면 활성화됩니다.</p>
            )}
            <div className="flex flex-col gap-2.5">
              {EVENT_TOGGLES.map(({ key, label }) => (
                <Controller
                  key={key}
                  name={key}
                  control={control}
                  render={({ field }) => (
                    <label
                      className={`flex cursor-pointer items-center gap-2.5 ${
                        togglesDisabled ? 'pointer-events-none opacity-40' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        disabled={togglesDisabled}
                        className="size-4 accent-brand"
                      />
                      <span className="text-sm text-neutral-base">{label}</span>
                    </label>
                  )}
                />
              ))}
            </div>
          </section>

          {/* 게이트 미리보기 */}
          <section className="rounded-lg border border-border bg-surface/40 p-3 text-xs">
            <p className="font-semibold text-neutral-base/70 mb-1">현재 발송 가능 여부 미리보기</p>
            {gatePreview.enabled ? (
              <p className="text-success">✓ 예약 확정 알림 발송 가능 상태입니다.</p>
            ) : (
              <p className="text-brand">
                ✕ 차단 사유:{' '}
                {gatePreview.reason === 'GLOBAL_DISABLED' && '전역 발송 비활성'}
                {gatePreview.reason === 'EVENT_DISABLED' && '행사 정책이 발송 안 함'}
                {gatePreview.reason === 'EVENT_TYPE_DISABLED' && '예약 확정 토글 OFF'}
              </p>
            )}
          </section>

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={!isDirty || isSubmitting}
            >
              {isSubmitting ? '저장 중…' : '저장'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
