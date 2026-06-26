import { describe, it, expect } from 'vitest';
import {
  scorePercent,
  summarizeProposals,
  proposalHasConflict,
  emptySlots,
} from '@/lib/allocation';
import type { MatchingSlotRow } from '@/types/eventDetail';
import type { MatchingProposalRow } from '@/types/aiAllocation';

function slot(over: Partial<MatchingSlotRow>): MatchingSlotRow {
  return {
    id: 's1',
    event_id: 'e1',
    expert_id: 'x1',
    startup_id: null,
    start_time: '2026-07-10T01:00:00.000Z',
    end_time: '2026-07-10T01:40:00.000Z',
    table_id: null,
    booking_type: 'NONE',
    session_status: 'WAITING',
    ...over,
  };
}

function proposal(over: Partial<MatchingProposalRow>): MatchingProposalRow {
  return {
    id: 'p1',
    event_id: 'e1',
    target_slot_id: 's1',
    startup_id: 'su1',
    score: 95,
    field_matched: true,
    unmatched_reason: null,
    is_locked: false,
    ...over,
  };
}

describe('scorePercent', () => {
  it('0~100 정수로 클램프·반올림', () => {
    expect(scorePercent(95)).toBe(95);
    expect(scorePercent(100.4)).toBe(100);
    expect(scorePercent(140)).toBe(100);
    expect(scorePercent(-5)).toBe(0);
    expect(scorePercent(Number.NaN)).toBe(0);
  });
});

describe('summarizeProposals', () => {
  it('배정/미배치/분야불일치/잠금을 센다', () => {
    const s = summarizeProposals([
      proposal({ id: 'p1', field_matched: true }),
      proposal({ id: 'p2', field_matched: false }),
      proposal({ id: 'p3', target_slot_id: null, unmatched_reason: '시간 충돌' }),
      proposal({ id: 'p4', is_locked: true }),
    ]);
    expect(s).toEqual({ matched: 3, unmatched: 1, fieldMismatch: 1, locked: 1 });
  });
});

describe('emptySlots', () => {
  it('미예약·대기 슬롯만 남긴다', () => {
    const slots = [
      slot({ id: 'a' }),
      slot({ id: 'b', startup_id: 'su9' }),
      slot({ id: 'c', session_status: 'CANCELLED' }),
    ];
    expect(emptySlots(slots).map((s) => s.id)).toEqual(['a']);
  });
});

describe('proposalHasConflict', () => {
  const target = slot({ id: 's1', start_time: '2026-07-10T01:00:00.000Z', end_time: '2026-07-10T01:40:00.000Z' });

  it('충돌 없음', () => {
    const byId = new Map([[target.id, target]]);
    expect(proposalHasConflict(proposal({}), byId, [target])).toBe(false);
  });

  it('대상 슬롯이 이미 예약되면 충돌', () => {
    const booked = slot({ id: 's1', startup_id: 'other' });
    const byId = new Map([[booked.id, booked]]);
    expect(proposalHasConflict(proposal({}), byId, [booked])).toBe(true);
  });

  it('대상 슬롯이 사라지면 충돌', () => {
    expect(proposalHasConflict(proposal({}), new Map(), [])).toBe(true);
  });

  it('스타트업이 동시간 확정 예약을 가지면 충돌', () => {
    const other = slot({
      id: 's2',
      expert_id: 'x2',
      startup_id: 'su1',
      booking_type: 'MANUAL',
      start_time: '2026-07-10T01:20:00.000Z',
      end_time: '2026-07-10T02:00:00.000Z',
    });
    const byId = new Map([
      [target.id, target],
      [other.id, other],
    ]);
    expect(proposalHasConflict(proposal({ startup_id: 'su1' }), byId, [target, other])).toBe(true);
  });

  it('미배치 제안은 충돌 아님', () => {
    expect(proposalHasConflict(proposal({ target_slot_id: null }), new Map(), [])).toBe(false);
  });
});
