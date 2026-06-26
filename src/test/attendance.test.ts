import { describe, it, expect } from 'vitest';
import {
  attendanceKey,
  attendanceStatusFor,
  latestAttendanceMap,
  summarizeAttendance,
} from '@/lib/attendance';
import type { AttendanceLogRow } from '@/types/attendance';
import type { MatchingSlotRow } from '@/types/eventDetail';

function log(partial: Partial<AttendanceLogRow> & Pick<AttendanceLogRow, 'id'>): AttendanceLogRow {
  return {
    matching_slot_id: 'S1',
    user_id: 'U1',
    role_type: 'STARTUP',
    attendance_status: 'PRESENT',
    checked_in_at: '2026-07-10T01:00:00.000Z',
    ...partial,
  };
}

function slot(partial: Partial<MatchingSlotRow> & Pick<MatchingSlotRow, 'id'>): MatchingSlotRow {
  return {
    event_id: 'E',
    expert_id: 'X1',
    startup_id: 'ST1',
    start_time: '2026-07-10T01:00:00.000Z',
    end_time: '2026-07-10T01:40:00.000Z',
    table_id: null,
    booking_type: 'MANUAL',
    session_status: 'WAITING',
    ...partial,
  };
}

describe('latestAttendanceMap', () => {
  it('동일 (슬롯,사용자)는 checked_in_at 최신 레코드가 이긴다(입력 순서 무관)', () => {
    const map = latestAttendanceMap([
      log({ id: 'a', attendance_status: 'PRESENT', checked_in_at: '2026-07-10T01:00:00.000Z' }),
      log({ id: 'b', attendance_status: 'ABSENT', checked_in_at: '2026-07-10T02:00:00.000Z' }),
    ]);
    expect(map.get(attendanceKey('S1', 'U1'))?.attendance_status).toBe('ABSENT');
  });

  it('역순으로 들어와도 최신이 이긴다', () => {
    const map = latestAttendanceMap([
      log({ id: 'b', attendance_status: 'ABSENT', checked_in_at: '2026-07-10T02:00:00.000Z' }),
      log({ id: 'a', attendance_status: 'PRESENT', checked_in_at: '2026-07-10T01:00:00.000Z' }),
    ]);
    expect(map.get(attendanceKey('S1', 'U1'))?.attendance_status).toBe('ABSENT');
  });

  it('서로 다른 (슬롯,사용자)는 별개 항목', () => {
    const map = latestAttendanceMap([
      log({ id: 'a', matching_slot_id: 'S1', user_id: 'U1' }),
      log({ id: 'b', matching_slot_id: 'S2', user_id: 'U1' }),
      log({ id: 'c', matching_slot_id: 'S1', user_id: 'U2' }),
    ]);
    expect(map.size).toBe(3);
  });
});

describe('attendanceStatusFor', () => {
  const map = latestAttendanceMap([log({ id: 'a', attendance_status: 'PRESENT' })]);
  it('기록이 있으면 상태를 반환', () => {
    expect(attendanceStatusFor(map, 'S1', 'U1')).toBe('PRESENT');
  });
  it('기록 없으면 null(미확인)', () => {
    expect(attendanceStatusFor(map, 'S9', 'U1')).toBeNull();
  });
  it('사용자가 null 이면 null', () => {
    expect(attendanceStatusFor(map, 'S1', null)).toBeNull();
  });
});

describe('summarizeAttendance', () => {
  it('예약된 슬롯의 전문가/스타트업 출석 인원을 센다', () => {
    const slots = [
      slot({ id: 'S1', expert_id: 'X1', startup_id: 'ST1' }),
      slot({ id: 'S2', expert_id: 'X1', startup_id: 'ST2' }),
    ];
    const map = latestAttendanceMap([
      log({ id: 'a', matching_slot_id: 'S1', user_id: 'X1', role_type: 'EXPERT', attendance_status: 'PRESENT' }),
      log({ id: 'b', matching_slot_id: 'S1', user_id: 'ST1', attendance_status: 'PRESENT' }),
      log({ id: 'c', matching_slot_id: 'S2', user_id: 'ST2', attendance_status: 'ABSENT' }),
    ]);
    const sum = summarizeAttendance(slots, map);
    expect(sum).toEqual({
      expertPresent: 1,
      expertTotal: 2,
      startupPresent: 1,
      startupTotal: 2,
    });
  });

  it('빈 슬롯·취소 슬롯은 집계에서 제외', () => {
    const slots = [
      slot({ id: 'S1', startup_id: null }),
      slot({ id: 'S2', startup_id: 'ST1', session_status: 'CANCELLED' }),
      slot({ id: 'S3', startup_id: 'ST2' }),
    ];
    const sum = summarizeAttendance(slots, latestAttendanceMap([]));
    expect(sum.startupTotal).toBe(1);
    expect(sum.expertTotal).toBe(1);
  });
});
