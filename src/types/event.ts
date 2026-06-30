/**
 * 행사 도메인 타입 (docs/db_schema.md §2.1, page_admin_event_list.md).
 * events 테이블의 관리자 화면에서 쓰는 컬럼 + 카드 통계를 모델링한다.
 */

/** 행사 진행 상태(전진 전용: DRAFT→BOOKING→ALLOCATION→PROGRESS→FINISHED, 별도 CANCELLED). */
export type EventStatus =
  | 'DRAFT'
  | 'BOOKING'
  | 'ALLOCATION'
  | 'PROGRESS'
  | 'FINISHED'
  | 'CANCELLED';

/** 목록 필터 탭 값(전체 포함). */
export type EventFilter = 'ALL' | EventStatus;

/**
 * 행사별 만족도 수집 정책 (8-D, functional_followup_plan.md T6).
 * - EVENT_ONLY: 행사 전체 만족도만 / - EXPERT_ONLY: 상담 전문가별 만족도만
 * - BOTH: 둘 다 / - NONE: 수집 안 함. 전문가별 실제 수집·집계는 8-G.
 */
export type SatisfactionPolicy = 'EVENT_ONLY' | 'EXPERT_ONLY' | 'BOTH' | 'NONE';

/** events 테이블 한 행(관리자 목록·폼에서 쓰는 컬럼). */
export interface EventRow {
  id: string;
  title: string;
  status: EventStatus;
  status_override: boolean;
  status_override_reason: string | null;
  booking_start: string;
  booking_end: string;
  event_start: string;
  event_end: string;
  max_sessions_per_startup: number;
  allow_startup_self_booking: boolean;
  /** 한 행사에서 동일 전문가와 2회 이상 예약 허용 여부(기본 FALSE = 1회 제한). */
  allow_duplicate_expert: boolean;
  /** 만족도 수집 정책(기본 EVENT_ONLY). */
  satisfaction_policy: SatisfactionPolicy;
  timezone: string;
  created_at: string;
}

/** 카드에 노출하는 참가 통계가 더해진 행사. */
export interface EventWithCounts extends EventRow {
  no: number;
  expertCount: number;
  startupCount: number;
}
