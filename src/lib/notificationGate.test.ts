import { describe, it, expect } from 'vitest';
import { canDispatchExternally, getDispatchMode } from './notificationGate';
import type { NotificationSettings, EventNotificationSettings } from '@/types/notificationSettings';

const makeGlobal = (
  overrides: Partial<NotificationSettings> = {},
): NotificationSettings => ({
  id: 1,
  provider: 'MOCK',
  dispatch_enabled: true,
  sender_phone: null,
  provider_configured_at: null,
  last_tested_at: null,
  last_test_status: null,
  updated_by: null,
  updated_at: '2026-06-28T00:00:00Z',
  ...overrides,
});

const makeEvent = (
  overrides: Partial<EventNotificationSettings> = {},
): EventNotificationSettings => ({
  event_id: 'evt-1',
  notification_policy: 'ALIMTALK',
  template_set_id: null,
  send_booking_open: true,
  send_booking_created: true,
  send_booking_changed: true,
  send_booking_cancelled: true,
  send_unbooked_reminder: false,
  send_event_reminder: false,
  updated_by: null,
  updated_at: '2026-06-28T00:00:00Z',
  ...overrides,
});

describe('canDispatchExternally', () => {
  it('전역 설정 null → GLOBAL_DISABLED', () => {
    const result = canDispatchExternally(null, makeEvent(), 'BOOKING_CREATED');
    expect(result).toEqual({ enabled: false, reason: 'GLOBAL_DISABLED' });
  });

  it('dispatch_enabled=false → GLOBAL_DISABLED', () => {
    const result = canDispatchExternally(
      makeGlobal({ dispatch_enabled: false }),
      makeEvent(),
      'BOOKING_CREATED',
    );
    expect(result).toEqual({ enabled: false, reason: 'GLOBAL_DISABLED' });
  });

  it('행사 설정 null → EVENT_DISABLED', () => {
    const result = canDispatchExternally(makeGlobal(), null, 'BOOKING_CREATED');
    expect(result).toEqual({ enabled: false, reason: 'EVENT_DISABLED' });
  });

  it('정책 NONE → EVENT_DISABLED', () => {
    const result = canDispatchExternally(
      makeGlobal(),
      makeEvent({ notification_policy: 'NONE' }),
      'BOOKING_CREATED',
    );
    expect(result).toEqual({ enabled: false, reason: 'EVENT_DISABLED' });
  });

  it('이벤트 타입 토글 OFF → EVENT_TYPE_DISABLED', () => {
    const result = canDispatchExternally(
      makeGlobal(),
      makeEvent({ send_booking_created: false }),
      'BOOKING_CREATED',
    );
    expect(result).toEqual({ enabled: false, reason: 'EVENT_TYPE_DISABLED' });
  });

  it('알 수 없는 이벤트 타입 → EVENT_TYPE_DISABLED', () => {
    const result = canDispatchExternally(makeGlobal(), makeEvent(), 'UNKNOWN_TYPE');
    expect(result).toEqual({ enabled: false, reason: 'EVENT_TYPE_DISABLED' });
  });

  it('모두 통과 → enabled=true', () => {
    const result = canDispatchExternally(makeGlobal(), makeEvent(), 'BOOKING_CREATED');
    expect(result).toEqual({ enabled: true, reason: null });
  });
});

describe('getDispatchMode', () => {
  it('설정 null → FREE_OPERATION', () => {
    expect(getDispatchMode(null)).toBe('FREE_OPERATION');
  });

  it('dispatch_enabled=false → FREE_OPERATION', () => {
    expect(getDispatchMode(makeGlobal({ dispatch_enabled: false }))).toBe('FREE_OPERATION');
  });

  it('provider=MOCK, enabled → MOCK', () => {
    expect(getDispatchMode(makeGlobal({ provider: 'MOCK', dispatch_enabled: true }))).toBe('MOCK');
  });

  it('provider=SOLAPI, sender_phone 있음 → LIVE', () => {
    expect(
      getDispatchMode(makeGlobal({ provider: 'SOLAPI', dispatch_enabled: true, sender_phone: '01012345678' })),
    ).toBe('LIVE');
  });

  it('provider=SOLAPI, sender_phone 없음 → INCOMPLETE', () => {
    expect(
      getDispatchMode(makeGlobal({ provider: 'SOLAPI', dispatch_enabled: true, sender_phone: null })),
    ).toBe('INCOMPLETE');
  });
});
