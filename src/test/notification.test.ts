import { describe, it, expect } from 'vitest';
import {
  isRetryable,
  maskDestination,
  sortByAttention,
  statusWeight,
  summarizeNotifications,
} from '@/lib/notification';
import { NOTIFICATION_STATUS_LABELS, notificationTypeLabel } from '@/lib/labels';
import type { NotificationLog } from '@/types/notification';

function log(partial: Partial<NotificationLog> & Pick<NotificationLog, 'id'>): NotificationLog {
  return {
    event_id: 'E',
    receiver_id: 'U',
    notification_type: 'BOOKING_CREATED',
    channel: 'ALIMTALK',
    destination: '01012345678',
    content: '내용',
    status: 'PENDING',
    retry_count: 0,
    next_retry_at: null,
    error_message: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: null,
    ...partial,
  };
}

describe('maskDestination', () => {
  it('이메일은 앞 2자만 노출하고 도메인은 유지한다', () => {
    expect(maskDestination('EMAIL', 'founder@acme.com')).toBe('fo*****@acme.com');
  });

  it('짧은 로컬파트도 최소 1개는 마스킹한다', () => {
    expect(maskDestination('EMAIL', 'ab@x.com')).toBe('ab*@x.com');
  });

  it('전화번호는 끝 4자리만 노출한다', () => {
    expect(maskDestination('ALIMTALK', '01012345678')).toBe('*******5678');
    expect(maskDestination('SMS', '01012345678')).toBe('*******5678');
  });

  it('빈 값/형식 이상은 *** 로 처리한다', () => {
    expect(maskDestination('EMAIL', '')).toBe('***');
    expect(maskDestination('EMAIL', 'noatsign')).toBe('***');
  });
});

describe('isRetryable', () => {
  it('FAILED 만 재시도 대상이다', () => {
    expect(isRetryable({ status: 'FAILED' })).toBe(true);
    expect(isRetryable({ status: 'PENDING' })).toBe(false);
    expect(isRetryable({ status: 'SENT' })).toBe(false);
  });
});

describe('summarizeNotifications', () => {
  it('상태별 건수를 집계한다', () => {
    const summary = summarizeNotifications([
      log({ id: '1', status: 'PENDING' }),
      log({ id: '2', status: 'SENT' }),
      log({ id: '3', status: 'SENT' }),
      log({ id: '4', status: 'FAILED' }),
    ]);
    expect(summary).toEqual({ total: 4, pending: 1, sent: 2, failed: 1 });
  });

  it('빈 배열은 0 으로 집계한다', () => {
    expect(summarizeNotifications([])).toEqual({ total: 0, pending: 0, sent: 0, failed: 0 });
  });
});

describe('statusWeight / sortByAttention', () => {
  it('실패 < 대기 < 완료 순의 가중치', () => {
    expect(statusWeight('FAILED')).toBeLessThan(statusWeight('PENDING'));
    expect(statusWeight('PENDING')).toBeLessThan(statusWeight('SENT'));
  });

  it('실패·대기를 앞으로, 동일 상태는 최신 갱신 순으로 정렬한다', () => {
    const sorted = sortByAttention([
      log({ id: 'sent', status: 'SENT', created_at: '2026-07-01T05:00:00.000Z' }),
      log({ id: 'failed', status: 'FAILED', created_at: '2026-07-01T01:00:00.000Z' }),
      log({ id: 'pending-old', status: 'PENDING', created_at: '2026-07-01T02:00:00.000Z' }),
      log({ id: 'pending-new', status: 'PENDING', created_at: '2026-07-01T04:00:00.000Z' }),
    ]);
    expect(sorted.map((l) => l.id)).toEqual(['failed', 'pending-new', 'pending-old', 'sent']);
  });

  it('updated_at 이 있으면 그것을 정렬 기준으로 쓴다', () => {
    const sorted = sortByAttention([
      log({ id: 'a', status: 'PENDING', created_at: '2026-07-01T01:00:00.000Z', updated_at: '2026-07-01T01:00:00.000Z' }),
      log({ id: 'b', status: 'PENDING', created_at: '2026-07-01T02:00:00.000Z', updated_at: '2026-07-01T09:00:00.000Z' }),
    ]);
    expect(sorted.map((l) => l.id)).toEqual(['b', 'a']);
  });
});

describe('labels', () => {
  it('상태 라벨이 모든 상태를 덮는다', () => {
    expect(NOTIFICATION_STATUS_LABELS.PENDING).toBeTruthy();
    expect(NOTIFICATION_STATUS_LABELS.SENT).toBeTruthy();
    expect(NOTIFICATION_STATUS_LABELS.FAILED).toBeTruthy();
  });

  it('알림 종류 라벨은 미정의 시 원문을 반환한다', () => {
    expect(notificationTypeLabel('BOOKING_CREATED')).toBe('예약 확정');
    expect(notificationTypeLabel('UNKNOWN_KIND')).toBe('UNKNOWN_KIND');
  });
});
