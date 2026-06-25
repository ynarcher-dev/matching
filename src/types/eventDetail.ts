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
  expert_organization: string | null;
  expert_position: string | null;
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
}

/** 예약 현황 통계(BOOKING 위젯, page_admin_event_detail.md §2.2). */
export interface BookingStats {
  totalSlots: number;
  bookedSlots: number;
  emptySlots: number;
  /** 예약율(0~1). 슬롯이 없으면 0. */
  bookingRate: number;
  /** 1건 이상 예약한 스타트업 수. */
  bookedStartupCount: number;
  /** 참가 스타트업 중 예약이 0건인 수. */
  unbookedStartupCount: number;
}
