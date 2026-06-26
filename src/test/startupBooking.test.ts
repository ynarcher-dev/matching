import { describe, it, expect } from 'vitest';
import {
  alreadyBookedExpert,
  bookingBlockReason,
  conflictsWithMine,
  isAvailable,
  isMine,
  myBookedSlots,
  myBookingCount,
  slotsByExpert,
  slotsByTime,
} from '@/lib/startupBooking';
import type { MatchingSlotRow } from '@/types/eventDetail';

/** 슬롯 픽스처 생성 헬퍼(시간은 ISO 문자열 사전 비교로 충분). */
function slot(partial: Partial<MatchingSlotRow> & Pick<MatchingSlotRow, 'id'>): MatchingSlotRow {
  return {
    event_id: 'E',
    expert_id: 'X1',
    startup_id: null,
    start_time: '2026-07-10T01:00:00.000Z',
    end_time: '2026-07-10T01:40:00.000Z',
    table_id: null,
    booking_type: 'NONE',
    session_status: 'WAITING',
    ...partial,
  };
}

const ME = 'me';

describe('isAvailable / isMine', () => {
  it('미점유·비취소 슬롯은 예약 가능', () => {
    expect(isAvailable(slot({ id: 's' }))).toBe(true);
  });
  it('점유된 슬롯은 예약 불가', () => {
    expect(isAvailable(slot({ id: 's', startup_id: 'other' }))).toBe(false);
  });
  it('취소된 빈 슬롯도 예약 불가', () => {
    expect(isAvailable(slot({ id: 's', session_status: 'CANCELLED' }))).toBe(false);
  });
  it('내 슬롯 판정은 취소를 제외한다', () => {
    expect(isMine(slot({ id: 's', startup_id: ME }), ME)).toBe(true);
    expect(isMine(slot({ id: 's', startup_id: ME, session_status: 'CANCELLED' }), ME)).toBe(false);
  });
});

describe('myBookedSlots / myBookingCount', () => {
  const slots = [
    slot({ id: 'a', startup_id: ME, start_time: '2026-07-10T03:00:00.000Z' }),
    slot({ id: 'b', startup_id: ME, start_time: '2026-07-10T01:00:00.000Z' }),
    slot({ id: 'c', startup_id: 'other' }),
    slot({ id: 'd', startup_id: ME, session_status: 'CANCELLED' }),
  ];
  it('내 비취소 예약만 시작시각 오름차순', () => {
    expect(myBookedSlots(slots, ME).map((s) => s.id)).toEqual(['b', 'a']);
  });
  it('카운트는 내 비취소 예약 수', () => {
    expect(myBookingCount(slots, ME)).toBe(2);
  });
  it('excludeSlotId 는 카운트에서 제외(변경 시)', () => {
    expect(myBookingCount(slots, ME, 'a')).toBe(1);
  });
});

describe('slotsByExpert / slotsByTime', () => {
  const slots = [
    slot({ id: 'a', expert_id: 'X1', start_time: '2026-07-10T02:00:00.000Z' }),
    slot({ id: 'b', expert_id: 'X1', start_time: '2026-07-10T01:00:00.000Z' }),
    slot({ id: 'c', expert_id: 'X2', start_time: '2026-07-10T01:00:00.000Z' }),
    slot({ id: 'z', expert_id: 'X2', session_status: 'CANCELLED' }),
  ];
  it('전문가별로 묶고 각 전문가 내 시작시각 오름차순(취소 제외)', () => {
    const m = slotsByExpert(slots);
    expect(m.get('X1')!.map((s) => s.id)).toEqual(['b', 'a']);
    expect(m.get('X2')!.map((s) => s.id)).toEqual(['c']);
  });
  it('시간대별 컬럼은 오름차순·취소 제외', () => {
    const { columns, byTime } = slotsByTime(slots);
    expect(columns).toEqual(['2026-07-10T01:00:00.000Z', '2026-07-10T02:00:00.000Z']);
    expect(byTime.get('2026-07-10T01:00:00.000Z')!.map((s) => s.id).sort()).toEqual(['b', 'c']);
  });
});

describe('충돌 판정', () => {
  it('내 기존 예약과 시간 겹치면 충돌', () => {
    const mine = slot({ id: 'a', startup_id: ME, expert_id: 'X2' });
    const target = slot({ id: 't', expert_id: 'X1' }); // 동일 시간대
    expect(conflictsWithMine([mine, target], target, ME)).toBe(true);
  });
  it('겹치지 않으면 충돌 아님', () => {
    const mine = slot({
      id: 'a',
      startup_id: ME,
      start_time: '2026-07-10T05:00:00.000Z',
      end_time: '2026-07-10T05:40:00.000Z',
    });
    const target = slot({ id: 't' });
    expect(conflictsWithMine([mine, target], target, ME)).toBe(false);
  });
  it('동일 전문가 기존 예약이 있으면 중복', () => {
    const mine = slot({
      id: 'a',
      startup_id: ME,
      expert_id: 'X1',
      start_time: '2026-07-10T08:00:00.000Z',
      end_time: '2026-07-10T08:40:00.000Z',
    });
    const target = slot({ id: 't', expert_id: 'X1' });
    expect(alreadyBookedExpert([mine, target], target, ME)).toBe(true);
  });
  it('excludeSlotId 로 변경 대상 자신을 제외하면 중복 아님', () => {
    const mine = slot({ id: 'a', startup_id: ME, expert_id: 'X1' });
    const target = slot({ id: 't', expert_id: 'X1' });
    expect(alreadyBookedExpert([mine, target], target, ME, 'a')).toBe(false);
  });
});

describe('bookingBlockReason', () => {
  const target = slot({ id: 't', expert_id: 'X1' });
  it('빈 슬롯·한도 미달·충돌 없음이면 null', () => {
    expect(bookingBlockReason([target], target, ME, 3)).toBeNull();
  });
  it('마감된 슬롯은 차단', () => {
    const taken = slot({ id: 't', startup_id: 'other' });
    expect(bookingBlockReason([taken], taken, ME, 3)).toContain('마감');
  });
  it('한도 도달 시 차단', () => {
    const mine = [
      slot({ id: 'a', startup_id: ME, expert_id: 'Xa', start_time: '2026-07-10T20:00:00.000Z', end_time: '2026-07-10T20:40:00.000Z' }),
      slot({ id: 'b', startup_id: ME, expert_id: 'Xb', start_time: '2026-07-10T21:00:00.000Z', end_time: '2026-07-10T21:40:00.000Z' }),
    ];
    expect(bookingBlockReason([...mine, target], target, ME, 2)).toContain('한도 초과');
  });
  it('변경 시 excludeSlotId 로 자기 자리는 한도/중복에서 제외', () => {
    const from = slot({ id: 'a', startup_id: ME, expert_id: 'X1', start_time: '2026-07-10T20:00:00.000Z', end_time: '2026-07-10T20:40:00.000Z' });
    // 한도 1 이지만 from 을 비우고 같은 전문가 다른 시간으로 이동 → 허용
    expect(bookingBlockReason([from, target], target, ME, 1, { excludeSlotId: 'a' })).toBeNull();
  });
  it('동일 전문가 기존 예약이 있으면 기본은 차단', () => {
    const mine = slot({ id: 'a', startup_id: ME, expert_id: 'X1', start_time: '2026-07-10T20:00:00.000Z', end_time: '2026-07-10T20:40:00.000Z' });
    expect(bookingBlockReason([mine, target], target, ME, 3)).toContain('동일 전문가');
  });
  it('allowDuplicateExpert ON 이면 동일 전문가 중복을 허용(다른 시간대)', () => {
    const mine = slot({ id: 'a', startup_id: ME, expert_id: 'X1', start_time: '2026-07-10T20:00:00.000Z', end_time: '2026-07-10T20:40:00.000Z' });
    expect(bookingBlockReason([mine, target], target, ME, 3, { allowDuplicateExpert: true })).toBeNull();
  });
  it('allowDuplicateExpert ON 이어도 동시간 충돌은 여전히 차단', () => {
    // 같은 전문가, target 과 동일 시간대의 내 예약 → 시간 충돌로 차단
    const mine = slot({ id: 'a', startup_id: ME, expert_id: 'X1' });
    expect(
      bookingBlockReason([mine, target], target, ME, 3, { allowDuplicateExpert: true }),
    ).toContain('같은 시간대');
  });
});
