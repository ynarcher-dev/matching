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

/** 식사(점심) 시간대 — 이 구간과 겹치는 세션은 구간 종료 이후로 밀린다(UTC ISO). */
export interface MealWindow {
  startIso: string;
  endIso: string;
}

/** 슬롯 생성 시 반영할 식사 구간의 최대 개수. */
export const MAX_MEAL_WINDOWS = 3;

/** 종료가 시작보다 늦은 유효 구간만 시작 시각 오름차순으로 정리한다. */
function normalizeMeals(meals: MealWindow[]): { start: dayjs.Dayjs; end: dayjs.Dayjs }[] {
  return meals
    .map((m) => ({ start: dayjs.utc(m.startIso), end: dayjs.utc(m.endIso) }))
    .filter((m) => m.end.isAfter(m.start))
    .sort((a, b) => a.start.valueOf() - b.start.valueOf());
}

/**
 * 전문가 1인 트랙의 슬롯 시간 목록을 만든다(전문가별로 동일하게 반복 생성).
 * @param startIso 첫 세션 시작(UTC ISO)
 * @param sessionMinutes 세션 길이(분)
 * @param breakMinutes 세션 사이 휴식(분)
 * @param sessionCount 세션 횟수
 * @param meals 식사 시간대 목록(선택, 최대 3개). 세션이 어떤 구간과 겹치면 그 구간 종료로 커서를 밀어 이어간다.
 *
 * DB generate_event_slots RPC 와 동일한 커서 규칙을 재현한다:
 * 커서에서 세션을 배치하고 (세션+휴식)만큼 전진하되, 세션이 식사 구간과 겹치면 커서를 식사 종료로 점프.
 * 여러 구간이 인접/연속이면 겹침이 사라질 때까지 반복 점프한다.
 */
export function buildSlotTrack(
  startIso: string,
  sessionMinutes: number,
  breakMinutes: number,
  sessionCount: number,
  meals?: MealWindow[] | null,
): SlotTime[] {
  const out: SlotTime[] = [];
  if (sessionCount <= 0 || sessionMinutes <= 0) return out;

  const step = sessionMinutes + Math.max(0, breakMinutes);
  const windows = normalizeMeals(meals ?? []);

  let cursor = dayjs.utc(startIso);
  for (let i = 0; i < sessionCount; i++) {
    // 이 세션이 어떤 식사 구간과 겹치면 커서를 그 종료로 민다. 인접 구간 대비 겹침이 없어질 때까지 반복.
    let moved = true;
    while (moved) {
      moved = false;
      for (const w of windows) {
        if (cursor.isBefore(w.end) && cursor.add(sessionMinutes, 'minute').isAfter(w.start)) {
          cursor = w.end;
          moved = true;
        }
      }
    }
    const start = cursor;
    const end = start.add(sessionMinutes, 'minute');
    out.push({ startIso: start.toISOString(), endIso: end.toISOString() });
    cursor = cursor.add(step, 'minute');
  }
  return out;
}

/** 트랙의 마지막 종료 시각(UTC ISO). 빈 트랙이면 시작 시각을 그대로 돌려준다. */
export function slotTrackEndIso(
  startIso: string,
  sessionMinutes: number,
  breakMinutes: number,
  sessionCount: number,
  meals?: MealWindow[] | null,
): string {
  const track = buildSlotTrack(startIso, sessionMinutes, breakMinutes, sessionCount, meals);
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
