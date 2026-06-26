import type { AppRole, AppUser } from '@/types/auth';
import type { EventStatus } from '@/types/event';
import type { AssignableUser, BookingType, SessionStatus } from '@/types/eventDetail';
import type { NotificationStatus } from '@/types/notification';
import type { AuthChannel, OtpChannel, OtpStatus, ParticipantRole } from '@/types/user';

/**
 * DB 영문 enum → 한국어 라벨 단일 매핑 (dev_conventions.md 2장).
 * 라벨은 반드시 이 파일을 경유한다(컴포넌트 내 하드코딩 금지).
 */
export const ROLE_LABELS: Record<AppRole, string> = {
  ADMIN: '운영진',
  STAFF: '현장 스태프',
  EXPERT: '전문가/자문위원',
  STARTUP: '참가 스타트업',
};

/** 행사 상태 한국어 라벨 (page_admin_event_list.md §1.2). */
export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  DRAFT: '대기',
  BOOKING: '예약',
  ALLOCATION: '배치 조율',
  PROGRESS: '진행',
  FINISHED: '종료',
  CANCELLED: '취소',
};

/** 참가자 역할 한국어 라벨(역할 탭·테이블). */
export const PARTICIPANT_ROLE_LABELS: Record<ParticipantRole, string> = {
  STARTUP: '스타트업',
  EXPERT: '전문가',
};

/** 슬롯 예약 경로 한국어 라벨 (page_admin_event_detail.md §3.1 — 수동/AI/강제). */
export const BOOKING_TYPE_LABELS: Record<BookingType, string> = {
  NONE: '미예약',
  MANUAL: '수동',
  AUTO_AI: 'AI',
  ADMIN_FORCE: '강제',
};

/** 세션 진행 상태 한국어 라벨 (page_admin_event_detail.md §3.1 배지). */
export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  WAITING: '대기중',
  IN_PROGRESS: '진행중',
  COMPLETED: '완료',
  NO_SHOW: '불참',
  CANCELLED: '취소',
};

/** 인증/발송 채널 한국어 라벨. */
export const CHANNEL_LABELS: Record<OtpChannel | AuthChannel, string> = {
  EMAIL: '이메일',
  SMS: '문자',
  ALIMTALK: '알림톡',
};

/** 알림 발송 상태 한국어 라벨 (notification_logs.status). */
export const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  PENDING: '대기/재시도',
  SENT: '발송 완료',
  FAILED: '영구 실패',
};

/** 알림 종류 한국어 라벨 (notification_logs.notification_type). 미정의 종류는 원문 노출. */
export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  BOOKING_CREATED: '예약 확정',
  BOOKING_CHANGED: '예약 변경',
  BOOKING_CANCELLED: '예약 취소',
  EVENT_BOOKING_OPEN: '예약 시작 안내',
  PARTICIPANT_LOGIN_OTP: '로그인 인증번호',
};

/** 알림 종류 라벨 해석(미정의 시 원문 그대로). */
export function notificationTypeLabel(type: string): string {
  return NOTIFICATION_TYPE_LABELS[type] ?? type;
}

/** 최근 OTP 발송 상태 한국어 라벨 (admin_participant_auth_overview). */
export const OTP_STATUS_LABELS: Record<OtpStatus, string> = {
  SENT: '발송됨',
  USED: '인증 완료',
  EXPIRED: '만료',
  INVALIDATED: '무효화',
  NONE: '이력 없음',
};

/**
 * 행사 참가자/슬롯에 노출할 참가자 호칭.
 * - 스타트업: "기업명 · 대표명"(없으면 이름)
 * - 전문가: "이름 · 소속"(없으면 이름)
 */
export function participantLabel(u: AssignableUser): string {
  if (u.role === 'STARTUP') {
    if (!u.company_name) return u.name;
    return u.representative_name ? `${u.company_name} · ${u.representative_name}` : u.company_name;
  }
  return u.expert_organization ? `${u.name} · ${u.expert_organization}` : u.name;
}

/** 배치 표 셀 표기: 스타트업 기업명만(없으면 이름). */
export function companyName(u: AssignableUser): string {
  return u.company_name ?? u.name;
}

/**
 * 헤더에 노출할 사용자 호칭.
 * - 스타트업: "기업명 / 대표명 대표님"
 * - 전문가: "이름 직책"
 * - 운영진: 이름
 */
export function displayName(user: AppUser): string {
  if (user.role === 'STARTUP') {
    const rep = user.representative_name ?? user.name;
    const company = user.company_name ? `${user.company_name} · ` : '';
    return `${company}${rep} 대표님`;
  }
  if (user.role === 'EXPERT') {
    return user.expert_position ? `${user.name} ${user.expert_position}` : user.name;
  }
  return user.name;
}
