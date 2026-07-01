import { describe, it, expect } from 'vitest';
import { buildSlotTrack, plannedSlotCount, slotTrackEndIso } from '@/lib/slots';
import { slotGenerationSchema } from '@/schemas/eventDetailSchemas';

const START = '2026-07-10T01:00:00.000Z';

describe('buildSlotTrack', () => {
  it('휴식 없이 연속 슬롯을 만든다', () => {
    const track = buildSlotTrack(START, 40, 0, 3);
    expect(track).toEqual([
      { startIso: '2026-07-10T01:00:00.000Z', endIso: '2026-07-10T01:40:00.000Z' },
      { startIso: '2026-07-10T01:40:00.000Z', endIso: '2026-07-10T02:20:00.000Z' },
      { startIso: '2026-07-10T02:20:00.000Z', endIso: '2026-07-10T03:00:00.000Z' },
    ]);
  });

  it('휴식 시간을 세션 사이에만 반영한다(끝 휴식 없음)', () => {
    const track = buildSlotTrack(START, 40, 10, 2);
    expect(track).toEqual([
      { startIso: '2026-07-10T01:00:00.000Z', endIso: '2026-07-10T01:40:00.000Z' },
      { startIso: '2026-07-10T01:50:00.000Z', endIso: '2026-07-10T02:30:00.000Z' },
    ]);
  });

  it('동일 입력에 동일 결과(결정적)', () => {
    expect(buildSlotTrack(START, 30, 5, 4)).toEqual(buildSlotTrack(START, 30, 5, 4));
  });

  it('횟수·길이가 0 이하이면 빈 배열', () => {
    expect(buildSlotTrack(START, 40, 0, 0)).toEqual([]);
    expect(buildSlotTrack(START, 0, 0, 3)).toEqual([]);
  });

  it('식사 시간과 겹치는 세션은 식사 종료 이후로 밀린다', () => {
    const start = '2026-07-10T00:00:00.000Z';
    const meals = [{ startIso: '2026-07-10T03:00:00.000Z', endIso: '2026-07-10T04:00:00.000Z' }];
    const track = buildSlotTrack(start, 40, 0, 6, meals);
    expect(track).toEqual([
      { startIso: '2026-07-10T00:00:00.000Z', endIso: '2026-07-10T00:40:00.000Z' },
      { startIso: '2026-07-10T00:40:00.000Z', endIso: '2026-07-10T01:20:00.000Z' },
      { startIso: '2026-07-10T01:20:00.000Z', endIso: '2026-07-10T02:00:00.000Z' },
      { startIso: '2026-07-10T02:00:00.000Z', endIso: '2026-07-10T02:40:00.000Z' },
      // 02:40~03:20 은 식사(03:00~04:00)와 겹치므로 04:00 으로 점프
      { startIso: '2026-07-10T04:00:00.000Z', endIso: '2026-07-10T04:40:00.000Z' },
      { startIso: '2026-07-10T04:40:00.000Z', endIso: '2026-07-10T05:20:00.000Z' },
    ]);
  });

  it('세션이 식사 시작에 정확히 끝나면 밀리지 않는다(경계)', () => {
    const start = '2026-07-10T02:20:00.000Z'; // 02:20~03:00 → 식사 03:00 시작에 딱 붙음
    const meals = [{ startIso: '2026-07-10T03:00:00.000Z', endIso: '2026-07-10T04:00:00.000Z' }];
    const track = buildSlotTrack(start, 40, 0, 2, meals);
    expect(track).toEqual([
      { startIso: '2026-07-10T02:20:00.000Z', endIso: '2026-07-10T03:00:00.000Z' },
      // 03:00~03:40 은 식사와 겹치므로 04:00 으로 점프
      { startIso: '2026-07-10T04:00:00.000Z', endIso: '2026-07-10T04:40:00.000Z' },
    ]);
  });

  it('식사 구간을 최대 3개까지 반영한다(순서 무관·인접 구간 연속 점프)', () => {
    const start = '2026-07-10T00:00:00.000Z';
    // 정렬 안 된 순서로 전달: 오전(01:00~01:30)·연속 점심(02:00~02:30, 02:30~03:00).
    // 02:00~03:00 사이 30분 틈은 40분 세션이 못 들어가고, 연속 구간을 한 번에 넘어간다.
    const meals = [
      { startIso: '2026-07-10T02:00:00.000Z', endIso: '2026-07-10T02:30:00.000Z' },
      { startIso: '2026-07-10T01:00:00.000Z', endIso: '2026-07-10T01:30:00.000Z' },
      { startIso: '2026-07-10T02:30:00.000Z', endIso: '2026-07-10T03:00:00.000Z' },
    ];
    const track = buildSlotTrack(start, 40, 0, 4, meals);
    expect(track).toEqual([
      { startIso: '2026-07-10T00:00:00.000Z', endIso: '2026-07-10T00:40:00.000Z' },
      // 00:40 부터 01:00~03:00 구간에 막혀 다음 가능 시점은 03:00
      { startIso: '2026-07-10T03:00:00.000Z', endIso: '2026-07-10T03:40:00.000Z' },
      { startIso: '2026-07-10T03:40:00.000Z', endIso: '2026-07-10T04:20:00.000Z' },
      { startIso: '2026-07-10T04:20:00.000Z', endIso: '2026-07-10T05:00:00.000Z' },
    ]);
  });

  it('식사 구간이 없으면(빈 배열) 기본 그리드와 동일', () => {
    expect(buildSlotTrack(START, 40, 0, 3, [])).toEqual(buildSlotTrack(START, 40, 0, 3));
  });

  it('식사 구간이 종료<=시작이면 그 구간은 무시', () => {
    const meals = [{ startIso: '2026-07-10T02:00:00.000Z', endIso: '2026-07-10T02:00:00.000Z' }];
    expect(buildSlotTrack(START, 40, 0, 3, meals)).toEqual(buildSlotTrack(START, 40, 0, 3));
  });
});

describe('slotTrackEndIso', () => {
  it('마지막 세션 종료 시각을 돌려준다', () => {
    expect(slotTrackEndIso(START, 40, 0, 3)).toBe('2026-07-10T03:00:00.000Z');
  });
  it('빈 트랙이면 시작 시각을 그대로 돌려준다', () => {
    expect(slotTrackEndIso(START, 40, 0, 0)).toBe(START);
  });
});

describe('plannedSlotCount', () => {
  it('전문가 수 × 세션 횟수', () => {
    expect(plannedSlotCount(3, 6)).toBe(18);
  });
  it('어느 한쪽이 0이면 0', () => {
    expect(plannedSlotCount(0, 6)).toBe(0);
    expect(plannedSlotCount(3, 0)).toBe(0);
  });
});

describe('slotGenerationSchema', () => {
  const base = {
    start_local: '2026-07-10T10:00',
    session_minutes: 40,
    break_minutes: 0,
    session_count: 6,
  };

  it('정상 입력을 통과시킨다', () => {
    expect(slotGenerationSchema.safeParse(base).success).toBe(true);
  });

  it('문자열 숫자를 강제 변환한다(coerce)', () => {
    const parsed = slotGenerationSchema.safeParse({
      ...base,
      session_minutes: '40',
      session_count: '6',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.session_minutes).toBe(40);
      expect(parsed.data.session_count).toBe(6);
    }
  });

  it('시작 시각이 비면 거부', () => {
    expect(slotGenerationSchema.safeParse({ ...base, start_local: '' }).success).toBe(false);
  });

  it('RPC 범위를 벗어난 값(세션 길이 0·횟수 51)을 거부', () => {
    expect(slotGenerationSchema.safeParse({ ...base, session_minutes: 0 }).success).toBe(false);
    expect(slotGenerationSchema.safeParse({ ...base, session_count: 51 }).success).toBe(false);
  });

  it('식사 시간 미입력(빈 배열/미지정)은 통과', () => {
    expect(slotGenerationSchema.safeParse({ ...base, meals: [] }).success).toBe(true);
    expect(slotGenerationSchema.safeParse(base).success).toBe(true);
  });

  it('식사 구간 1~3개 정상 입력은 통과', () => {
    expect(
      slotGenerationSchema.safeParse({
        ...base,
        meals: [
          { start: '10:00', end: '10:30' },
          { start: '12:00', end: '13:00' },
          { start: '15:00', end: '15:20' },
        ],
      }).success,
    ).toBe(true);
  });

  it('식사 구간이 4개 이상이면 거부', () => {
    expect(
      slotGenerationSchema.safeParse({
        ...base,
        meals: [
          { start: '10:00', end: '10:30' },
          { start: '12:00', end: '13:00' },
          { start: '15:00', end: '15:20' },
          { start: '16:00', end: '16:20' },
        ],
      }).success,
    ).toBe(false);
  });

  it('식사 구간 한쪽이 비었거나 종료<=시작이면 거부', () => {
    expect(
      slotGenerationSchema.safeParse({ ...base, meals: [{ start: '12:00', end: '' }] }).success,
    ).toBe(false);
    expect(
      slotGenerationSchema.safeParse({ ...base, meals: [{ start: '13:00', end: '12:00' }] }).success,
    ).toBe(false);
    expect(
      slotGenerationSchema.safeParse({ ...base, meals: [{ start: '12:00', end: '12:00' }] }).success,
    ).toBe(false);
  });
});
