/**
 * 행사 상세 대시보드 도메인 타입 (docs/db_schema.md §2.6~2.8, page_admin_event_detail.md).
 * 참가자 지정·테이블 관리·예약 현황·강제 조정에서 쓰는 행 모델.
 */

import type { ParticipantRole } from '@/types/user';

/** 슬롯 예약 경로(db_schema chk_booking_type). */
export type BookingType = 'NONE' | 'MANUAL' | 'AUTO_AI' | 'ADMIN_FORCE';

/** 세션 진행 상태(db_schema chk_session_status). */
export type SessionStatus = 'WAITING' | 'IN_PROGRESS' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';

/** event_tables 한 행 (db_schema §2.7). */
export interface EventTable {
  id: string;
  event_id: string;
  table_code: string;
  description: string | null;
  is_active: boolean;
  /** 테이블 현장 담당자(행사 배정 오퍼레이터 user_id). 담당 전문가와 별개. null=미지정. */
  manager_user_id: string | null;
}

/** event_participants 한 행 (db_schema §2.6). */
export interface EventParticipantRow {
  id: string;
  event_id: string;
  user_id: string;
  participant_type: ParticipantRole;
  default_table_id: string | null;
}

/** 지정 후보·이름 해석에 쓰는 경량 사용자 행(EXPERT/STARTUP). */
export interface AssignableUser {
  id: string;
  name: string;
  role: ParticipantRole;
  company_name: string | null;
  representative_name: string | null;
  /** 스타트업 담당자명(상세 모달 표시 — 스타트업 DB 와 동일). */
  contact_name: string | null;
  /** 스타트업 홈페이지(상세 모달 표시 — 스타트업 DB 와 동일). */
  company_homepage: string | null;
  expert_organization: string | null;
  expert_position: string | null;
  email: string | null;
  phone_number: string | null;
  /** 스타트업 기업 소개 / 전문가 소개(소개 컬럼 노출용). */
  company_description: string | null;
  expert_description: string | null;
  /** 관심/전문 분야 id 목록(user_fields M:N). */
  field_ids: string[];
  /** 스타트업 IR/소개서 업로드 여부 확인용 객체 경로(8-H). 미업로드면 null. */
  proposal_file_url: string | null;
  /** 최근 로그인 시각(지정 표 운영 컬럼 — 스타트업 DB 와 동일). 미로그인이면 null. */
  last_login_at: string | null;
  /** 등록일(지정 표 운영 컬럼 — 스타트업 DB 와 동일). */
  created_at: string;
}

/** matching_slots 한 행 (db_schema §2.8). */
export interface MatchingSlotRow {
  id: string;
  event_id: string;
  expert_id: string;
  startup_id: string | null;
  start_time: string;
  end_time: string;
  table_id: string | null;
  booking_type: BookingType;
  session_status: SessionStatus;
  /** 스타트업이 입력한 상담 희망사항(0066). 전문가 Split View [요청] 탭에서 노출. 미선택 쿼리에서는 undefined. */
  counseling_request?: string | null;
}

/** 예약 현황 통계(BOOKING 위젯, page_admin_event_detail.md §2.2). */
export interface BookingStats {
  /** 전체 슬롯(취소 제외) — 전문가가 연 공급. */
  totalSlots: number;
  /** 취소가 아닌 예약 슬롯 수. */
  bookedSlots: number;
  /** 빈 슬롯(totalSlots − bookedSlots). */
  emptySlots: number;
  /** 참가 스타트업(기업) 수. */
  startupCount: number;
  /** 기업당 진행 횟수(events.max_sessions_per_startup). */
  maxSessions: number;
  /** 총 진행세션(목표 수요) = startupCount × maxSessions. */
  requiredSessions: number;
  /** 잔여 세션(부호 있음) = totalSlots − requiredSessions. 양수=예약 가능 여유, 음수=슬롯 추가 필요. */
  slotBalance: number;
  /** 충족률(0~1) = bookedSlots / requiredSessions. 수요가 0이면 0. */
  bookingRate: number;
  /** 1건 이상 예약한 스타트업 수. */
  bookedStartupCount: number;
  /** 참가 스타트업 중 예약이 0건인 수. */
  unbookedStartupCount: number;
}

/** 진행관리 통계(PROGRESS 위젯, page_admin_event_detail.md §3.1). */
export interface ProgressStats {
  /** 총 진행 세션 = 예약된(취소 제외) 세션 수. */
  total: number;
  /** 대기중 세션 수. */
  waiting: number;
  /** 진행중 세션 수. */
  inProgress: number;
  /** 완료 세션 수. */
  completed: number;
  /** 잔여 세션 = 대기중 + 진행중(아직 끝나지 않은 세션). */
  remaining: number;
  /** 불참(노쇼) 세션 수 — 카드에는 미표시, 잔여 계산 검증용. */
  noShow: number;
}
