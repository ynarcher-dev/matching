import { describe, it, expect } from 'vitest';
import { eventTableSchema, forceReasonSchema } from '@/schemas/eventDetailSchemas';
import {
  buildBookingSchedule,
  computeBookingStats,
  conflictingStartupIds,
  overlaps,
  unbookedStartupIds,
} from '@/lib/booking';
import { BOOKING_TYPE_LABELS, SESSION_STATUS_LABELS, participantLabel } from '@/lib/labels';
import type { AssignableUser, MatchingSlotRow } from '@/types/eventDetail';

/** 슬롯 픽스처 생성 헬퍼(시간은 단순 ISO 문자열 사전 비교로 충분). */
function slot(partial: Partial<MatchingSlotRow> & Pick<MatchingSlotRow, 'id'>): MatchingSlotRow {
  return {
    event_id: 'E',
    expert_id: 'X',
    startup_id: null,
    start_time: '2026-07-10T01:00:00.000Z',
    end_time: '2026-07-10T01:40:00.000Z',
    table_id: null,
    booking_type: 'NONE',
    session_status: 'WAITING',
    ...partial,
  };
}

describe('eventTableSchema', () => {
  it('코드가 있으면 통과(설명·사용여부)', () => {
    expect(
      eventTableSchema.safeParse({ table_code: 'A-1', description: '2층', is_active: true }).success,
    ).toBe(true);
  });
  it('빈 설명을 허용한다', () => {
    expect(
      eventTableSchema.safeParse({ table_code: 'A-1', description: '', is_active: false }).success,
    ).toBe(true);
  });
  it('코드가 비면 거부', () => {
    expect(
      eventTableSchema.safeParse({ table_code: '  ', description: '', is_active: true }).success,
    ).toBe(false);
  });
});

describe('forceReasonSchema', () => {
  it('사유가 있으면 통과, 비면 거부', () => {
    expect(forceReasonSchema.safeParse('동시간 미배정 해소').success).toBe(true);
    expect(forceReasonSchema.safeParse('   ').success).toBe(false);
  });
});

describe('overlaps', () => {
  it('겹치면 true, 인접(끝=시작)이면 false', () => {
    expect(overlaps('10:00', '10:40', '10:20', '11:00')).toBe(true);
    expect(overlaps('10:00', '10:40', '10:40', '11:00')).toBe(false);
  });
});

describe('computeBookingStats', () => {
  const startupIds = ['s1', 's2', 's3'];
  const slots: MatchingSlotRow[] = [
    slot({ id: 'a', startup_id: 's1', booking_type: 'MANUAL' }),
    slot({ id: 'b', startup_id: 's2', booking_type: 'AUTO_AI' }),
    slot({ id: 'c' }), // 빈 슬롯
    slot({ id: 'd', startup_id: 's1', session_status: 'CANCELLED' }), // 취소는 제외
  ];

  it('취소 슬롯을 제외하고 예약율을 계산한다', () => {
    const stats = computeBookingStats(slots, startupIds);
    expect(stats.totalSlots).toBe(3); // a, b, c (d 취소 제외)
    expect(stats.bookedSlots).toBe(2); // a, b
    expect(stats.emptySlots).toBe(1); // c
    expect(stats.bookingRate).toBeCloseTo(2 / 3);
  });

  it('예약/미예약 스타트업 수를 센다', () => {
    const stats = computeBookingStats(slots, startupIds);
    expect(stats.bookedStartupCount).toBe(2); // s1, s2
    expect(stats.unbookedStartupCount).toBe(1); // s3
  });

  it('슬롯이 없으면 예약율 0', () => {
    expect(computeBookingStats([], startupIds).bookingRate).toBe(0);
  });
});

describe('unbookedStartupIds', () => {
  it('예약 0건인 참가 스타트업만 반환', () => {
    const slots: MatchingSlotRow[] = [slot({ id: 'a', startup_id: 's1', booking_type: 'MANUAL' })];
    expect(unbookedStartupIds(slots, ['s1', 's2'])).toEqual(['s2']);
  });
});

describe('conflictingStartupIds', () => {
  const target = slot({
    id: 'target',
    start_time: '2026-07-10T01:00:00.000Z',
    end_time: '2026-07-10T01:40:00.000Z',
  });

  it('대상 시간과 겹치는 예약을 가진 스타트업을 집합으로 반환', () => {
    const all: MatchingSlotRow[] = [
      target,
      slot({
        id: 'o1',
        startup_id: 's1',
        booking_type: 'MANUAL',
        start_time: '2026-07-10T01:20:00.000Z',
        end_time: '2026-07-10T02:00:00.000Z',
      }),
      slot({
        id: 'o2',
        startup_id: 's2',
        booking_type: 'MANUAL',
        start_time: '2026-07-10T03:00:00.000Z',
        end_time: '2026-07-10T03:40:00.000Z',
      }),
    ];
    const conflicts = conflictingStartupIds(all, target);
    expect(conflicts.has('s1')).toBe(true);
    expect(conflicts.has('s2')).toBe(false);
  });

  it('취소된 겹침 예약은 충돌로 보지 않는다', () => {
    const all: MatchingSlotRow[] = [
      target,
      slot({
        id: 'o1',
        startup_id: 's1',
        session_status: 'CANCELLED',
        start_time: '2026-07-10T01:20:00.000Z',
        end_time: '2026-07-10T02:00:00.000Z',
      }),
    ];
    expect(conflictingStartupIds(all, target).has('s1')).toBe(false);
  });
});

describe('participantLabel', () => {
  const startup: AssignableUser = {
    id: 's',
    name: '홍길동',
    role: 'STARTUP',
    company_name: '가나다랩',
    representative_name: '김대표',
    expert_organization: null,
    expert_position: null,
  };
  const expert: AssignableUser = {
    id: 'e',
    name: '이전문',
    role: 'EXPERT',
    company_name: null,
    representative_name: null,
    expert_organization: '벤처협회',
    expert_position: '위원',
  };

  it('스타트업은 기업명·대표명을 조합한다', () => {
    expect(participantLabel(startup)).toBe('가나다랩 · 김대표');
  });
  it('전문가는 이름·소속을 조합한다', () => {
    expect(participantLabel(expert)).toBe('이전문 · 벤처협회');
  });
  it('스타트업 기업명이 없으면 이름으로 대체', () => {
    expect(participantLabel({ ...startup, company_name: null })).toBe('홍길동');
  });
});

describe('라벨 매핑 완전성', () => {
  it('예약 경로 4종·세션 상태 5종 라벨', () => {
    expect(Object.keys(BOOKING_TYPE_LABELS)).toHaveLength(4);
    expect(Object.keys(SESSION_STATUS_LABELS)).toHaveLength(5);
    expect(BOOKING_TYPE_LABELS.ADMIN_FORCE).toBe('강제');
    expect(SESSION_STATUS_LABELS.IN_PROGRESS).toBe('진행중');
  });
});

describe('buildBookingSchedule', () => {
  it('열=시작시각 오름차순(중복 제거), 행=전문가별 셀 매핑', () => {
    const t1 = '2026-07-10T01:00:00.000Z';
    const t2 = '2026-07-10T01:40:00.000Z';
    const slots = [
      slot({ id: 'a', expert_id: 'X1', start_time: t2, startup_id: 'S1', booking_type: 'MANUAL' }),
      slot({ id: 'b', expert_id: 'X1', start_time: t1 }),
      slot({ id: 'c', expert_id: 'X2', start_time: t1, startup_id: 'S2', booking_type: 'AUTO_AI' }),
    ];
    const { columns, byExpert } = buildBookingSchedule(slots);
    expect(columns).toEqual([t1, t2]);
    expect(byExpert.get('X1')?.get(t1)?.id).toBe('b');
    expect(byExpert.get('X1')?.get(t2)?.startup_id).toBe('S1');
    expect(byExpert.get('X2')?.get(t1)?.id).toBe('c');
    expect(byExpert.get('X2')?.get(t2)).toBeUndefined();
  });

  it('취소된 슬롯은 열·셀에서 제외한다', () => {
    const t1 = '2026-07-10T01:00:00.000Z';
    const { columns, byExpert } = buildBookingSchedule([
      slot({ id: 'a', expert_id: 'X1', start_time: t1, session_status: 'CANCELLED' }),
    ]);
    expect(columns).toEqual([]);
    expect(byExpert.size).toBe(0);
  });
});
