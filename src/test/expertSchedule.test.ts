import { describe, it, expect } from 'vitest';
import {
  classifySlot,
  formatCountdown,
  isCountdownWarning,
  pickActiveSlotId,
  remainingMs,
} from '@/lib/expertSchedule';
import type { MatchingSlotRow } from '@/types/eventDetail';

function slot(partial: Partial<MatchingSlotRow> & Pick<MatchingSlotRow, 'id'>): MatchingSlotRow {
  return {
    event_id: 'E',
    expert_id: 'X1',
    startup_id: 'S1',
    start_time: '2026-07-10T01:00:00.000Z',
    end_time: '2026-07-10T01:30:00.000Z',
    table_id: null,
    booking_type: 'MANUAL',
    session_status: 'WAITING',
    ...partial,
  };
}

const NOW = new Date('2026-07-10T01:10:00.000Z').getTime();

describe('remainingMs / formatCountdown', () => {
  it('남은 시간을 ms 로 계산한다(음수 가능)', () => {
    expect(remainingMs(NOW, '2026-07-10T01:30:00.000Z')).toBe(20 * 60 * 1000);
    expect(remainingMs(NOW, '2026-07-10T01:05:00.000Z')).toBe(-5 * 60 * 1000);
  });

  it('MM:SS 로 표기하고 음수는 00:00 으로 클램프한다', () => {
    expect(formatCountdown(20 * 60 * 1000)).toBe('20:00');
    expect(formatCountdown(65 * 1000)).toBe('01:05');
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-1000)).toBe('00:00');
  });

  it('60분 초과는 분 자리가 늘어난다', () => {
    expect(formatCountdown(65 * 60 * 1000)).toBe('65:00');
  });
});

describe('isCountdownWarning', () => {
  it('종료 전 5분 미만일 때만 경고', () => {
    expect(isCountdownWarning(4 * 60 * 1000)).toBe(true);
    expect(isCountdownWarning(5 * 60 * 1000)).toBe(false);
    expect(isCountdownWarning(0)).toBe(false);
    expect(isCountdownWarning(-1000)).toBe(false);
  });
});

describe('classifySlot', () => {
  it('진행 구간 안이면 active', () => {
    expect(classifySlot(slot({ id: 'A' }), NOW)).toBe('active');
  });

  it('시작 전이면 upcoming', () => {
    expect(
      classifySlot(slot({ id: 'B', start_time: '2026-07-10T02:00:00.000Z', end_time: '2026-07-10T02:30:00.000Z' }), NOW),
    ).toBe('upcoming');
  });

  it('종료 시각이 지나면 past', () => {
    expect(
      classifySlot(slot({ id: 'C', start_time: '2026-07-10T00:00:00.000Z', end_time: '2026-07-10T00:30:00.000Z' }), NOW),
    ).toBe('past');
  });

  it('종결 상태(완료/노쇼/취소)는 시간과 무관하게 past', () => {
    expect(classifySlot(slot({ id: 'D', session_status: 'COMPLETED' }), NOW)).toBe('past');
    expect(classifySlot(slot({ id: 'E', session_status: 'NO_SHOW' }), NOW)).toBe('past');
    expect(classifySlot(slot({ id: 'F', session_status: 'CANCELLED' }), NOW)).toBe('past');
  });
});

describe('pickActiveSlotId', () => {
  it('진행 중 슬롯을 우선 선택한다', () => {
    const slots = [
      slot({ id: 'past', start_time: '2026-07-10T00:00:00.000Z', end_time: '2026-07-10T00:30:00.000Z' }),
      slot({ id: 'now', start_time: '2026-07-10T01:00:00.000Z', end_time: '2026-07-10T01:30:00.000Z' }),
      slot({ id: 'next', start_time: '2026-07-10T02:00:00.000Z', end_time: '2026-07-10T02:30:00.000Z' }),
    ];
    expect(pickActiveSlotId(slots, NOW)).toBe('now');
  });

  it('진행 중이 없으면 다가오는 가장 이른 슬롯', () => {
    const slots = [
      slot({ id: 'past', start_time: '2026-07-10T00:00:00.000Z', end_time: '2026-07-10T00:30:00.000Z' }),
      slot({ id: 'next2', start_time: '2026-07-10T03:00:00.000Z', end_time: '2026-07-10T03:30:00.000Z' }),
      slot({ id: 'next1', start_time: '2026-07-10T02:00:00.000Z', end_time: '2026-07-10T02:30:00.000Z' }),
    ];
    expect(pickActiveSlotId(slots, NOW)).toBe('next1');
  });

  it('예약 안 된(startup_id 없는) 빈 슬롯은 제외', () => {
    const slots = [
      slot({ id: 'empty', startup_id: null }),
      slot({ id: 'next', start_time: '2026-07-10T02:00:00.000Z', end_time: '2026-07-10T02:30:00.000Z' }),
    ];
    expect(pickActiveSlotId(slots, NOW)).toBe('next');
  });

  it('대상이 없으면 null', () => {
    const slots = [
      slot({ id: 'past', start_time: '2026-07-10T00:00:00.000Z', end_time: '2026-07-10T00:30:00.000Z', session_status: 'COMPLETED' }),
    ];
    expect(pickActiveSlotId(slots, NOW)).toBeNull();
  });
});
