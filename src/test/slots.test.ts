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
    replace_unbooked: true,
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
});
