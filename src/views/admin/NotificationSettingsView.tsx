import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Card } from '@/components/common/Card';
import { Alert } from '@/components/common/Alert';
import { Button } from '@/components/common/Button';
import {
  useGlobalNotificationSettings,
  useUpdateGlobalNotificationSettings,
  useTestNotification,
} from '@/hooks/useNotificationSettings';
import { getDispatchMode } from '@/lib/notificationGate';
import { globalNotificationSettingsSchema } from '@/schemas/notificationSettingsSchemas';
import {
  DISPATCH_MODE_LABELS,
  NOTIFICATION_PROVIDER_LABELS,
} from '@/lib/labels';
import type { GlobalNotificationSettingsInput } from '@/schemas/notificationSettingsSchemas';
import { formatDateTime } from '@/lib/datetime';

/**
 * 전역 알림 설정 페이지 /admin/settings (page_admin_notification_settings.md §3.1).
 * 실제 발송 활성화 토글 + 공급사 선택 + 현재 모드 배지.
 * API 키/시크릿은 Edge Function 환경변수로만 관리하므로 이 화면에 노출하지 않는다.
 */
export function NotificationSettingsView() {
  const settingQ = useGlobalNotificationSettings();
  const update   = useUpdateGlobalNotificationSettings();
  const testSend = useTestNotification();
  const [testDest, setTestDest] = useState('');

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { isDirty, isSubmitting },
  } = useForm<GlobalNotificationSettingsInput>({
    resolver: zodResolver(globalNotificationSettingsSchema),
    defaultValues: {
      provider: 'MOCK',
      dispatch_enabled: false,
      sender_phone: null,
      event_notification_tab_enabled: false,
    },
  });

  useEffect(() => {
    if (settingQ.data) {
      reset({
        provider: settingQ.data.provider,
        dispatch_enabled: settingQ.data.dispatch_enabled,
        sender_phone: settingQ.data.sender_phone ?? null,
        event_notification_tab_enabled: settingQ.data.event_notification_tab_enabled,
      });
    }
  }, [settingQ.data, reset]);

  const globalSettings = settingQ.data ?? null;
  const dispatchMode   = getDispatchMode(globalSettings);
  const modeMeta       = DISPATCH_MODE_LABELS[dispatchMode];

  const provider        = watch('provider');
  const dispatchEnabled = watch('dispatch_enabled');
  const tabEnabled      = watch('event_notification_tab_enabled');

  const onSubmit = async (values: GlobalNotificationSettingsInput) => {
    await update.mutateAsync(values);
    reset(values);
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-neutral-base">알림 설정</h1>
        <p className="mt-1 text-sm text-neutral-base/60">
          실제 외부 발송은 이 페이지에서 명시적으로 활성화한 경우에만 수행됩니다.
          기본값은 항상 비활성(무료 운영)입니다.
        </p>
      </div>

      {/* 현재 모드 배지 */}
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-base font-bold text-neutral-base">현재 발송 모드</h2>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${modeMeta.className}`}>
            {modeMeta.label}
          </span>
          <span className="text-xs text-neutral-base/60">
            {dispatchMode === 'FREE_OPERATION' && '외부 API를 호출하지 않습니다. 수동 안내와 1회용 로그인 링크를 사용합니다.'}
            {dispatchMode === 'MOCK' && 'Mock 어댑터로 실제 발송 없이 로그만 기록합니다.'}
            {dispatchMode === 'LIVE' && '공급사 API로 실제 발송합니다. 비용이 발생합니다.'}
            {dispatchMode === 'INCOMPLETE' && 'Solapi가 선택됐지만 발신번호가 미설정 상태입니다.'}
          </span>
        </div>
        {settingQ.data?.last_tested_at && (
          <p className="text-xs text-neutral-base/50">
            마지막 테스트:{' '}
            {formatDateTime(settingQ.data.last_tested_at, 'Asia/Seoul')}{' '}
            — {settingQ.data.last_test_status === 'SUCCESS' ? '성공' : '실패'}
          </p>
        )}
      </Card>

      {/* 설정 폼 */}
      <Card className="flex flex-col gap-5 p-5">
        <h2 className="text-base font-bold text-neutral-base">발송 설정</h2>

        {settingQ.isError && (
          <Alert tone="error">설정을 불러오지 못했습니다.</Alert>
        )}
        {update.isError && (
          <Alert tone="error">{(update.error as Error).message ?? '저장에 실패했습니다.'}</Alert>
        )}
        {update.isSuccess && !isDirty && (
          <Alert tone="info">저장되었습니다.</Alert>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
          {/* 행사알림 탭 노출 (임시 전역 스위치) — 발송 로직과 무관한 UI 게이트. */}
          <section className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-neutral-base">행사알림 탭 노출</p>
            <p className="text-xs text-neutral-base/60">
              행사 상세 화면의 <strong>행사알림</strong> 탭을 표시할지 여부입니다. 정식 기능 정리
              전까지 임시로 노출을 제어합니다. OFF면 모든 관리자에게 해당 탭이 보이지 않습니다.
            </p>
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                {...register('event_notification_tab_enabled')}
                className="size-4 accent-brand"
              />
              <span className="text-sm text-neutral-base">
                행사알림 탭 노출 (현재: <strong>{tabEnabled ? 'ON' : 'OFF'}</strong>)
              </span>
            </label>
          </section>

          {/* 실제 발송 활성화 */}
          <section className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-neutral-base">실제 발송 활성화</p>
            <Alert tone="error">
              OFF 상태(기본값)에서는 외부 API를 호출하지 않습니다. ON으로 변경하면 행사별 정책에
              따라 실제 알림이 발송되며 비용이 발생할 수 있습니다.
            </Alert>
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                {...register('dispatch_enabled')}
                className="size-4 accent-brand"
              />
              <span className="text-sm text-neutral-base">
                실제 발송 활성화 (현재:{' '}
                <strong>{dispatchEnabled ? 'ON' : 'OFF'}</strong>)
              </span>
            </label>
          </section>

          {/* 공급사 선택 */}
          <section className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-neutral-base">공급사</p>
            <div className="flex flex-col gap-2">
              {(['MOCK', 'SOLAPI'] as const).map((p) => (
                <label key={p} className="flex cursor-pointer items-center gap-2.5">
                  <input
                    type="radio"
                    value={p}
                    {...register('provider')}
                    className="accent-brand"
                  />
                  <span className="text-sm text-neutral-base">
                    {NOTIFICATION_PROVIDER_LABELS[p]}
                  </span>
                </label>
              ))}
            </div>
          </section>

          {/* Solapi 발신번호 */}
          {provider === 'SOLAPI' && (
            <section className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-neutral-base">발신번호 (Solapi)</p>
              <p className="text-xs text-neutral-base/60">
                Solapi에 등록된 발신번호를 입력합니다. API 키/시크릿은 Edge Function 환경변수로
                관리합니다.
              </p>
              <input
                type="text"
                placeholder="01012345678"
                {...register('sender_phone')}
                className="rounded-lg border border-border px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
            </section>
          )}

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

      {/* 테스트 발송 (저장된 공급사 설정 기준, 전역 토글과 무관하게 동작) */}
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-base font-bold text-neutral-base">테스트 발송</h2>
        <p className="text-xs text-neutral-base/60">
          저장된 공급사 설정으로 테스트 메시지를 보냅니다. Mock 모드면 실제 발송 없이 로그만
          기록됩니다. 실제 발송 활성화 전에 설정 유효성을 확인하는 용도입니다.
        </p>

        {testSend.isError && (
          <Alert tone="error">{testSend.error.message ?? '테스트 발송에 실패했습니다.'}</Alert>
        )}
        {testSend.data && (
          testSend.data.ok ? (
            <Alert tone="info">
              테스트 발송 성공{testSend.data.provider ? ` (${testSend.data.provider})` : ''}.
            </Alert>
          ) : (
            <Alert tone="error">
              {testSend.data.reason === 'PROVIDER_NOT_CONFIGURED'
                ? '공급사 설정이 불완전합니다(API 키/발신번호 미설정). Edge Function 환경변수를 확인하세요.'
                : '테스트 발송에 실패했습니다.'}
            </Alert>
          )
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="test-dest" className="text-xs font-medium text-neutral-base/70">
              수신 휴대전화 번호
            </label>
            <input
              id="test-dest"
              type="tel"
              value={testDest}
              onChange={(e) => setTestDest(e.target.value)}
              placeholder="01012345678"
              className="rounded-lg border border-border px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => testSend.mutate(testDest)}
            disabled={testSend.isPending || testDest.trim().length < 9}
          >
            {testSend.isPending ? '발송 중…' : '테스트 발송'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
