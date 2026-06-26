import { describe, it, expect } from 'vitest';
import { eventFormSchema, cancelEventSchema } from '@/schemas/eventSchemas';
import { localInputToIso, isoToLocalInput, formatRange } from '@/lib/datetime';
import { EVENT_STATUS_LABELS } from '@/lib/labels';

const validForm = {
  title: '2026 매칭 데이',
  max_sessions_per_startup: 3,
  timezone: 'Asia/Seoul',
  allow_startup_self_booking: false,
  allow_duplicate_expert: false,
  booking_start: '2026-07-01T09:00',
  booking_end: '2026-07-05T18:00',
  event_start: '2026-07-10T10:00',
  event_end: '2026-07-10T18:00',
};

describe('eventFormSchema', () => {
  it('정상 입력을 통과시킨다', () => {
    expect(eventFormSchema.safeParse(validForm).success).toBe(true);
  });

  it('행사명이 비면 거부', () => {
    expect(eventFormSchema.safeParse({ ...validForm, title: '  ' }).success).toBe(false);
  });

  it('최대 상담 횟수는 1 이상 정수', () => {
    expect(eventFormSchema.safeParse({ ...validForm, max_sessions_per_startup: 0 }).success).toBe(
      false,
    );
    // 문자열 입력(폼 number 필드)도 coerce 로 허용
    expect(
      eventFormSchema.safeParse({ ...validForm, max_sessions_per_startup: '5' }).success,
    ).toBe(true);
  });

  it('예약 마감은 예약 시작 이후여야 한다', () => {
    const r = eventFormSchema.safeParse({
      ...validForm,
      booking_start: '2026-07-05T18:00',
      booking_end: '2026-07-01T09:00',
    });
    expect(r.success).toBe(false);
  });

  it('행사 시작은 예약 마감 이후여야 한다 (booking_end <= event_start)', () => {
    const r = eventFormSchema.safeParse({
      ...validForm,
      booking_end: '2026-07-11T00:00',
      event_start: '2026-07-10T10:00',
    });
    expect(r.success).toBe(false);
  });

  it('행사 종료는 행사 시작 이후여야 한다', () => {
    const r = eventFormSchema.safeParse({
      ...validForm,
      event_start: '2026-07-10T18:00',
      event_end: '2026-07-10T10:00',
    });
    expect(r.success).toBe(false);
  });
});

describe('cancelEventSchema', () => {
  it('사유가 있으면 통과, 비면 거부', () => {
    expect(cancelEventSchema.safeParse({ reason: '주최측 사정' }).success).toBe(true);
    expect(cancelEventSchema.safeParse({ reason: '   ' }).success).toBe(false);
  });
});

describe('datetime 변환 (timezone 왕복)', () => {
  it('Asia/Seoul 벽시계 → UTC ISO 로 9시간 당겨진다', () => {
    expect(localInputToIso('2026-07-01T10:00', 'Asia/Seoul')).toBe('2026-07-01T01:00:00.000Z');
  });

  it('UTC ISO → Asia/Seoul 벽시계 왕복 보존', () => {
    const iso = localInputToIso('2026-07-01T10:00', 'Asia/Seoul');
    expect(isoToLocalInput(iso, 'Asia/Seoul')).toBe('2026-07-01T10:00');
  });

  it('formatRange: 같은 날이면 종료는 시각만 표기', () => {
    const start = localInputToIso('2026-07-10T10:00', 'Asia/Seoul');
    const end = localInputToIso('2026-07-10T18:00', 'Asia/Seoul');
    expect(formatRange(start, end, 'Asia/Seoul')).toBe('2026.07.10 10:00 ~ 18:00');
  });

  it('formatRange: 다른 날이면 종료도 날짜 포함', () => {
    const start = localInputToIso('2026-07-01T09:00', 'Asia/Seoul');
    const end = localInputToIso('2026-07-05T18:00', 'Asia/Seoul');
    expect(formatRange(start, end, 'Asia/Seoul')).toBe('2026.07.01 09:00 ~ 2026.07.05 18:00');
  });
});

describe('EVENT_STATUS_LABELS', () => {
  it('6개 상태 모두 한국어 라벨을 가진다', () => {
    expect(EVENT_STATUS_LABELS.DRAFT).toBe('대기');
    expect(EVENT_STATUS_LABELS.CANCELLED).toBe('취소');
    expect(Object.keys(EVENT_STATUS_LABELS)).toHaveLength(6);
  });
});
