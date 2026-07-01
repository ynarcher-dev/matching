/** 알림 공급사 종류. */
export type NotificationProvider = 'MOCK' | 'SOLAPI';

/** 행사별 알림 채널 정책. */
export type NotificationPolicy = 'NONE' | 'ALIMTALK' | 'SMS' | 'ALIMTALK_SMS';

/** 관리자 UI 발송 모드 배지. */
export type DispatchMode = 'FREE_OPERATION' | 'MOCK' | 'LIVE' | 'INCOMPLETE';

/** 전역 알림 설정 (싱글턴 행 id=1). */
export interface NotificationSettings {
  id: 1;
  provider: NotificationProvider;
  dispatch_enabled: boolean;
  sender_phone: string | null;
  provider_configured_at: string | null;
  last_tested_at: string | null;
  last_test_status: 'SUCCESS' | 'FAILED' | null;
  /** 행사 상세 '행사알림' 탭 노출 여부(임시 전역 스위치). */
  event_notification_tab_enabled: boolean;
  updated_by: string | null;
  updated_at: string;
}

/** 행사별 알림 설정. */
export interface EventNotificationSettings {
  event_id: string;
  notification_policy: NotificationPolicy;
  template_set_id: string | null;
  send_booking_open: boolean;
  send_booking_created: boolean;
  send_booking_changed: boolean;
  send_booking_cancelled: boolean;
  send_unbooked_reminder: boolean;
  send_event_reminder: boolean;
  updated_by: string | null;
  updated_at: string;
}

/** 이벤트 타입 토글 컬럼 매핑 (표시용). */
export interface EventToggleItem {
  key: keyof Pick<
    EventNotificationSettings,
    | 'send_booking_open'
    | 'send_booking_created'
    | 'send_booking_changed'
    | 'send_booking_cancelled'
    | 'send_unbooked_reminder'
    | 'send_event_reminder'
  >;
  label: string;
}
