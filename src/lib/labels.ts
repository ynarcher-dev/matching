import type { AppRole, AppUser } from '@/types/auth';
import type { EventStatus, SatisfactionPolicy } from '@/types/event';
import type { AssignableUser, BookingType, SessionStatus } from '@/types/eventDetail';
import type { NotificationStatus } from '@/types/notification';
import type { AuthChannel, ParticipantRole } from '@/types/user';
import type { OperatorPermission, OperatorRole } from '@/types/operator';
import { BADGE_TONE, type Tone } from '@/lib/tone';

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

/** 행사별 만족도 수집 정책 한국어 라벨 (8-D, functional_followup_plan.md T6). */
export const SATISFACTION_POLICY_LABELS: Record<SatisfactionPolicy, string> = {
  EVENT_ONLY: '행사 전체 만족도만',
  EXPERT_ONLY: '상담 전문가별 만족도만',
  BOTH: '둘 다 수집',
  NONE: '수집 안 함',
};

/** 참가자 역할 한국어 라벨(역할 탭·테이블). */
export const PARTICIPANT_ROLE_LABELS: Record<ParticipantRole, string> = {
  STARTUP: '스타트업',
  EXPERT: '전문가',
};

/** 운영자 로그인 역할 한국어 라벨. */
export const OPERATOR_ROLE_LABELS: Record<OperatorRole, string> = {
  ADMIN: '관리자',
  STAFF: '현장 스태프',
};

/** 행사별 권한 등급 한국어 라벨 (page_admin_operator_permissions.md §2.2). */
export const OPERATOR_PERMISSION_LABELS: Record<OperatorPermission, string> = {
  OWNER: '행사 책임자',
  MANAGER: '운영 관리',
  STAFF: '현장',
  VIEWER: '조회 전용',
};

/** 슬롯 예약 경로 한국어 라벨 (page_admin_event_detail.md §3.1 — 수동/AI/강제). */
export const BOOKING_TYPE_LABELS: Record<BookingType, string> = {
  NONE: '미예약',
  MANUAL: '수동',
  AUTO_AI: 'AI배치',
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

/**
 * 세션 진행 상태별 의미 tone (대기/진행/완료/노쇼/취소).
 * 범례·셀 배지·진행 버튼이 모두 이 맵을 경유해 같은 상태 = 같은 색이 되도록 한다.
 * 읽기용은 BADGE_TONE, 선택(활성)은 SOLID_TONE 를 같은 tone 으로 조회한다.
 */
export const SESSION_STATUS_TONE: Record<SessionStatus, Tone> = {
  WAITING: 'neutral',
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  NO_SHOW: 'danger',
  CANCELLED: 'muted',
};

/** 인증/발송 채널 한국어 라벨. */
export const CHANNEL_LABELS: Record<AuthChannel | 'ALIMTALK', string> = {
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

/** 행사별 알림 채널 정책 한국어 라벨. */
export const NOTIFICATION_POLICY_LABELS: Record<string, string> = {
  NONE: '발송 안 함',
  ALIMTALK: '카카오 알림톡만',
  SMS: 'SMS만',
  ALIMTALK_SMS: '카카오 알림톡 + SMS fallback',
};

/** 알림 공급사 한국어 라벨. */
export const NOTIFICATION_PROVIDER_LABELS: Record<string, string> = {
  MOCK: 'Mock (개발/무료 운영)',
  SOLAPI: 'Solapi',
};

/** 발송 모드 배지 라벨 + 색상 클래스. */
export const DISPATCH_MODE_LABELS: Record<
  string,
  { label: string; className: string }
> = {
  FREE_OPERATION: { label: '무료 운영', className: BADGE_TONE.muted },
  MOCK:           { label: 'Mock 발송', className: BADGE_TONE.warning },
  LIVE:           { label: '실발송 가능', className: BADGE_TONE.success },
  INCOMPLETE:     { label: '설정 불완전', className: BADGE_TONE.danger },
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
