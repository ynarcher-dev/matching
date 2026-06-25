/**
 * 슬롯 자동 생성 시간표 계산 순수 함수 (page_admin_event_detail.md §2.1).
 * 미리보기 표시와 단위 테스트용. 실제 INSERT 는 generate_event_slots RPC(0015)가 수행하며,
 * 본 모듈은 DB 와 동일한 그리드 규칙(시작 + i*(세션+휴식), 길이=세션)을 재현한다.
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

/** 한 슬롯의 시작/종료(UTC ISO). */
export interface SlotTime {
  startIso: string;
  endIso: string;
}

/**
 * 전문가 1인 트랙의 슬롯 시간 목록을 만든다(전문가별로 동일하게 반복 생성).
 * @param startIso 첫 세션 시작(UTC ISO)
 * @param sessionMinutes 세션 길이(분)
 * @param breakMinutes 세션 사이 휴식(분)
 * @param sessionCount 세션 횟수
 */
export function buildSlotTrack(
  startIso: string,
  sessionMinutes: number,
  breakMinutes: number,
  sessionCount: number,
): SlotTime[] {
  const out: SlotTime[] = [];
  if (sessionCount <= 0 || sessionMinutes <= 0) return out;

  const step = sessionMinutes + Math.max(0, breakMinutes);
  const base = dayjs.utc(startIso);
  for (let i = 0; i < sessionCount; i++) {
    const start = base.add(i * step, 'minute');
    const end = start.add(sessionMinutes, 'minute');
    out.push({ startIso: start.toISOString(), endIso: end.toISOString() });
  }
  return out;
}

/** 트랙의 마지막 종료 시각(UTC ISO). 빈 트랙이면 시작 시각을 그대로 돌려준다. */
export function slotTrackEndIso(
  startIso: string,
  sessionMinutes: number,
  breakMinutes: number,
  sessionCount: number,
): string {
  const track = buildSlotTrack(startIso, sessionMinutes, breakMinutes, sessionCount);
  return track.length === 0 ? startIso : track[track.length - 1].endIso;
}

/**
 * 생성 예정 슬롯 총수 = 전문가 수 × 세션 횟수.
 * (재생성/충돌 회피로 실제 생성 수는 더 적을 수 있다 — RPC 반환값이 최종 권위.)
 */
export function plannedSlotCount(expertCount: number, sessionCount: number): number {
  if (expertCount <= 0 || sessionCount <= 0) return 0;
  return expertCount * sessionCount;
}
