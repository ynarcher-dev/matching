/**
 * 전문가 대시보드 시간표 순수 함수 (docs/page_expert_dashboard.md §1.2).
 * 카운트다운·활성 세션 판정 로직을 분리해 단위 테스트한다. 현재 시각(nowMs)을
 * 인자로 주입받아 결정적으로 동작하게 한다(컴포넌트가 setInterval 로 주기 갱신).
 */

import type { MatchingSlotRow } from '@/types/eventDetail';

/** 슬롯 진행 분류(시간·세션상태 기반). */
export type SlotPhase = 'active' | 'upcoming' | 'past';

/** 카운트다운 5분 미만 경고 임계값(ms). */
export const COUNTDOWN_WARNING_MS = 5 * 60 * 1000;

/** 남은 시간(ms). 음수면 종료 시각 경과. */
export function remainingMs(nowMs: number, endIso: string): number {
  return new Date(endIso).getTime() - nowMs;
}

/**
 * 남은 시간을 `MM:SS` 로 표기(0 미만은 `00:00`).
 * 60분을 초과하면 분 자리가 2자리 이상으로 늘어난다(예: 65:00).
 */
export function formatCountdown(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** 종료 전 5분 미만 잔여(점멸 경고 대상) 여부. */
export function isCountdownWarning(ms: number): boolean {
  return ms > 0 && ms < COUNTDOWN_WARNING_MS;
}

/**
 * 슬롯의 진행 분류.
 * - 종결(COMPLETED/NO_SHOW/CANCELLED) 또는 종료 시각 경과 → past
 * - 현재 시각이 [start, end) 안 → active
 * - 시작 전 → upcoming
 */
export function classifySlot(slot: MatchingSlotRow, nowMs: number): SlotPhase {
  if (
    slot.session_status === 'COMPLETED' ||
    slot.session_status === 'NO_SHOW' ||
    slot.session_status === 'CANCELLED'
  ) {
    return 'past';
  }
  const start = new Date(slot.start_time).getTime();
  const end = new Date(slot.end_time).getTime();
  if (nowMs >= end) return 'past';
  if (nowMs >= start) return 'active';
  return 'upcoming';
}

/**
 * 상단에 강조할 활성 세션을 고른다. 예약된(startup_id 있는) 슬롯만 대상.
 * 1) 진행 구간(active) 슬롯 중 가장 이른 시작,
 * 2) 없으면 다가오는(upcoming) 슬롯 중 가장 이른 시작.
 * 반환은 슬롯 id 또는 null.
 */
export function pickActiveSlotId(slots: MatchingSlotRow[], nowMs: number): string | null {
  const sorted = slots
    .filter((s) => s.startup_id)
    .slice()
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const active = sorted.find((s) => classifySlot(s, nowMs) === 'active');
  if (active) return active.id;
  const upcoming = sorted.find((s) => classifySlot(s, nowMs) === 'upcoming');
  return upcoming?.id ?? null;
}
