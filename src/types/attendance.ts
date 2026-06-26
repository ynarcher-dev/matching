/**
 * 출석(attendance_logs) 도메인 타입 (docs/db_schema.md §2.11, §4.5).
 * 출석은 행사 1회가 아니라 상담 슬롯마다 기록하며, (슬롯,사용자)별 최신 레코드를
 * 현재 출석 상태로 간주한다.
 */

import type { ParticipantRole } from '@/types/user';

/** 출석 상태(db_schema chk_attendance_status). */
export type AttendanceStatus = 'PRESENT' | 'ABSENT';

/** attendance_logs 한 행(현재 상태 판정에 필요한 컬럼만). */
export interface AttendanceLogRow {
  id: string;
  matching_slot_id: string;
  user_id: string;
  role_type: ParticipantRole;
  attendance_status: AttendanceStatus;
  checked_in_at: string;
}

/** 진행 현황 헤더용 출석 집계(예약된 세션 기준). */
export interface AttendanceSummary {
  expertPresent: number;
  expertTotal: number;
  startupPresent: number;
  startupTotal: number;
}
