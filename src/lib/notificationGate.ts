import type {
  NotificationSettings,
  EventNotificationSettings,
  DispatchMode,
  NotificationPolicy,
} from '@/types/notificationSettings';

/** canDispatchExternally 차단 사유. null = 차단 없음(발송 가능). */
export type DispatchBlockReason =
  | 'GLOBAL_DISABLED'
  | 'EVENT_DISABLED'
  | 'EVENT_TYPE_DISABLED'
  | null;

export interface DispatchGateResult {
  enabled: boolean;
  reason: DispatchBlockReason;
}

/**
 * 실제 외부 발송이 가능한지 판정한다 (docs/page_admin_notification_settings.md §2).
 * - 전역 dispatch_enabled = false → GLOBAL_DISABLED
 * - 행사 정책 = NONE 또는 미설정 → EVENT_DISABLED
 * - 해당 이벤트 타입 토글 OFF → EVENT_TYPE_DISABLED
 * - 모두 통과 → enabled=true
 */
export function canDispatchExternally(
  globalSettings: NotificationSettings | null,
  eventSettings: EventNotificationSettings | null,
  eventType: string,
): DispatchGateResult {
  if (!globalSettings || !globalSettings.dispatch_enabled) {
    return { enabled: false, reason: 'GLOBAL_DISABLED' };
  }

  if (!eventSettings || eventSettings.notification_policy === 'NONE') {
    return { enabled: false, reason: 'EVENT_DISABLED' };
  }

  const toggleMap: Record<string, boolean> = {
    EVENT_BOOKING_OPEN:  eventSettings.send_booking_open,
    BOOKING_CREATED:     eventSettings.send_booking_created,
    BOOKING_CHANGED:     eventSettings.send_booking_changed,
    BOOKING_CANCELLED:   eventSettings.send_booking_cancelled,
    UNBOOKED_REMINDER:   eventSettings.send_unbooked_reminder,
    EVENT_REMINDER:      eventSettings.send_event_reminder,
  };
  const toggle = toggleMap[eventType] ?? false;
  if (!toggle) {
    return { enabled: false, reason: 'EVENT_TYPE_DISABLED' };
  }

  return { enabled: true, reason: null };
}

/**
 * 현재 발송 모드 배지 계산 (docs/page_admin_notification_settings.md §3.1).
 * FREE_OPERATION: dispatch_enabled = false
 * MOCK:           dispatch_enabled = true, provider = MOCK
 * LIVE:           dispatch_enabled = true, provider = SOLAPI, sender_phone 설정됨
 * INCOMPLETE:     dispatch_enabled = true, provider = SOLAPI, sender_phone 미설정
 */
export function getDispatchMode(settings: NotificationSettings | null): DispatchMode {
  if (!settings || !settings.dispatch_enabled) return 'FREE_OPERATION';
  if (settings.provider === 'MOCK') return 'MOCK';
  if (settings.provider === 'SOLAPI') {
    return settings.sender_phone ? 'LIVE' : 'INCOMPLETE';
  }
  return 'INCOMPLETE';
}

/** 정책 값 → 채널 발송 여부. */
export function policyUsesAlimtalk(policy: NotificationPolicy): boolean {
  return policy === 'ALIMTALK' || policy === 'ALIMTALK_SMS';
}

export function policyUsesSms(policy: NotificationPolicy): boolean {
  return policy === 'SMS' || policy === 'ALIMTALK_SMS';
}
