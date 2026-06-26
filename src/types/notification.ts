/**
 * 알림 발송 로그 타입 (Phase 7 슬라이스 1).
 * 출처: docs/db_schema.md 2.15 notification_logs.
 */

/** 발송 채널(인증/알림 공용 정의와 동일). */
export type NotificationChannel = 'EMAIL' | 'SMS' | 'ALIMTALK';

/** 발송 상태. */
export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED';

/** 발송 이벤트 종류(notification_type). 트리거가 적재하는 값. */
export type NotificationType =
  | 'BOOKING_CREATED'
  | 'BOOKING_CHANGED'
  | 'BOOKING_CANCELLED'
  | 'EVENT_BOOKING_OPEN'
  | 'PARTICIPANT_LOGIN_OTP'
  | string;

/** notification_logs 행(관리자 조회). destination 은 화면 표기 전 마스킹한다. */
export interface NotificationLog {
  id: string;
  event_id: string | null;
  receiver_id: string | null;
  notification_type: NotificationType;
  channel: NotificationChannel;
  destination: string;
  content: string;
  status: NotificationStatus;
  retry_count: number;
  next_retry_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string | null;
}
