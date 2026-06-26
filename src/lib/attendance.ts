/**
 * 출석 상태 판정 순수 함수 (docs/db_schema.md §4.5).
 * attendance_logs 는 append-only 이며 (슬롯,사용자)별 최신 레코드가 현재 출석 상태다.
 * 화면이 호출하는 집계/토글 로직을 분리해 단위 테스트한다.
 */

import type {
  AttendanceLogRow,
  AttendanceStatus,
  AttendanceSummary,
} from '@/types/attendance';
import type { MatchingSlotRow } from '@/types/eventDetail';

/** (슬롯,사용자) 합성 키. */
export function attendanceKey(slotId: string, userId: string): string {
  return `${slotId}:${userId}`;
}

/**
 * (슬롯,사용자)별 최신 출석 레코드 맵. checked_in_at 최신이 현재 상태(db_schema §4.5).
 * 입력 순서에 의존하지 않도록 checked_in_at 으로 비교한다(ISO 문자열, 모두 UTC 가정).
 */
export function latestAttendanceMap(logs: AttendanceLogRow[]): Map<string, AttendanceLogRow> {
  const map = new Map<string, AttendanceLogRow>();
  for (const log of logs) {
    const key = attendanceKey(log.matching_slot_id, log.user_id);
    const prev = map.get(key);
    if (!prev || log.checked_in_at > prev.checked_in_at) {
      map.set(key, log);
    }
  }
  return map;
}

/** 특정 (슬롯,사용자)의 현재 출석 상태. 기록 없거나 사용자 미지정이면 null(미확인). */
export function attendanceStatusFor(
  map: Map<string, AttendanceLogRow>,
  slotId: string,
  userId: string | null,
): AttendanceStatus | null {
  if (!userId) return null;
  return map.get(attendanceKey(slotId, userId))?.attendance_status ?? null;
}

/**
 * 진행 현황 헤더 집계. 예약된(스타트업 배정·취소 아님) 슬롯=세션 기준으로
 * 전문가/스타트업의 출석(PRESENT) 인원을 센다. 출석은 슬롯마다 기록(db_schema §4.5).
 */
export function summarizeAttendance(
  slots: MatchingSlotRow[],
  map: Map<string, AttendanceLogRow>,
): AttendanceSummary {
  let expertPresent = 0;
  let expertTotal = 0;
  let startupPresent = 0;
  let startupTotal = 0;
  for (const s of slots) {
    if (!s.startup_id || s.session_status === 'CANCELLED') continue;
    expertTotal += 1;
    startupTotal += 1;
    if (attendanceStatusFor(map, s.id, s.expert_id) === 'PRESENT') expertPresent += 1;
    if (attendanceStatusFor(map, s.id, s.startup_id) === 'PRESENT') startupPresent += 1;
  }
  return { expertPresent, expertTotal, startupPresent, startupTotal };
}
