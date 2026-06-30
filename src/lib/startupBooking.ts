/**
 * 스타트업 예약 가능 여부·그룹화 순수 함수 (page_startup_booking.md §1.3, §2.1).
 * DB RPC(`book_slot`/`change_booking`/`_validate_slot_assignment`)와 동일 규칙의
 * 사전 안내·비활성 처리용. 최종 권위는 DB RPC 트랜잭션이다.
 */

import { overlaps } from '@/lib/booking';
import type { MatchingSlotRow } from '@/types/eventDetail';

/** 예약 가능한(빈) 슬롯인가: 미점유 + 취소 아님. */
export function isAvailable(slot: MatchingSlotRow): boolean {
  return slot.startup_id === null && slot.session_status !== 'CANCELLED';
}

/** 특정 스타트업이 점유한(취소 아닌) 슬롯인가. */
export function isMine(slot: MatchingSlotRow, myId: string): boolean {
  return slot.startup_id === myId && slot.session_status !== 'CANCELLED';
}

/** 내 예약 슬롯 목록(시작시각 오름차순). */
export function myBookedSlots(slots: MatchingSlotRow[], myId: string): MatchingSlotRow[] {
  return slots
    .filter((s) => isMine(s, myId))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
}

/** 내 현재 예약 수(횟수 제한 비교용). excludeSlotId 는 변경 중인 기존 슬롯 제외. */
export function myBookingCount(
  slots: MatchingSlotRow[],
  myId: string,
  excludeSlotId?: string,
): number {
  return slots.filter((s) => isMine(s, myId) && s.id !== excludeSlotId).length;
}

/** 슬롯을 전문가별로 묶는다(각 전문가 안에서 시작시각 오름차순). */
export function slotsByExpert(slots: MatchingSlotRow[]): Map<string, MatchingSlotRow[]> {
  const byExpert = new Map<string, MatchingSlotRow[]>();
  for (const s of slots) {
    if (s.session_status === 'CANCELLED') continue;
    const list = byExpert.get(s.expert_id);
    if (list) list.push(s);
    else byExpert.set(s.expert_id, [s]);
  }
  for (const list of byExpert.values()) {
    list.sort((a, b) => a.start_time.localeCompare(b.start_time));
  }
  return byExpert;
}

/** 슬롯을 시작시각별로 묶는다(시각 오름차순 컬럼 + 시각→슬롯들). */
export function slotsByTime(slots: MatchingSlotRow[]): {
  columns: string[];
  byTime: Map<string, MatchingSlotRow[]>;
} {
  const colSet = new Set<string>();
  const byTime = new Map<string, MatchingSlotRow[]>();
  for (const s of slots) {
    if (s.session_status === 'CANCELLED') continue;
    colSet.add(s.start_time);
    const list = byTime.get(s.start_time);
    if (list) list.push(s);
    else byTime.set(s.start_time, [s]);
  }
  const columns = [...colSet].sort((a, b) => a.localeCompare(b));
  return { columns, byTime };
}

/** 대상 슬롯이 내 다른 예약과 시간대가 겹치는가(자기 자신·제외 슬롯 제외). */
export function conflictsWithMine(
  slots: MatchingSlotRow[],
  target: MatchingSlotRow,
  myId: string,
  excludeSlotId?: string,
): boolean {
  return slots.some(
    (s) =>
      isMine(s, myId) &&
      s.id !== target.id &&
      s.id !== excludeSlotId &&
      overlaps(target.start_time, target.end_time, s.start_time, s.end_time),
  );
}

/** 대상 전문가를 이미 예약했는가(같은 행사 내 동일 전문가 중복 차단, 제외 슬롯 제외). */
export function alreadyBookedExpert(
  slots: MatchingSlotRow[],
  target: MatchingSlotRow,
  myId: string,
  excludeSlotId?: string,
): boolean {
  return slots.some(
    (s) =>
      isMine(s, myId) &&
      s.id !== target.id &&
      s.id !== excludeSlotId &&
      s.expert_id === target.expert_id,
  );
}

/**
 * 클라이언트 사전 검증: 대상 슬롯 예약을 막아야 하는 사유(없으면 null).
 * @param max 행사별 최대 상담 횟수(`max_sessions_per_startup`)
 * @param opts.excludeSlotId 변경 시 기존 슬롯(해제 예정)을 모든 검사에서 제외
 * @param opts.allowDuplicateExpert 행사 설정 ON 이면 동일 전문가 중복 검사 생략(연속 예약 허용)
 */
export function bookingBlockReason(
  slots: MatchingSlotRow[],
  target: MatchingSlotRow,
  myId: string,
  max: number,
  opts?: { excludeSlotId?: string; allowDuplicateExpert?: boolean },
): string | null {
  const exclude = opts?.excludeSlotId;
  if (!isAvailable(target)) return '이미 마감된 슬롯입니다.';
  if (myBookingCount(slots, myId, exclude) >= max) {
    return `예약 한도 초과: 행사별 최대 ${max}회까지만 예약할 수 있습니다.`;
  }
  if (!opts?.allowDuplicateExpert && alreadyBookedExpert(slots, target, myId, exclude)) {
    return '한 행사에서 동일 전문가와 두 번 이상 예약할 수 없습니다.';
  }
  if (conflictsWithMine(slots, target, myId, exclude)) {
    return '같은 시간대에 이미 다른 상담이 예약되어 있습니다.';
  }
  return null;
}

/**
 * 슬롯 한 칸의 표시 상태(전문가별·시간대별 보기 공통).
 *  - none    : 슬롯 없음(매트릭스 빈칸)
 *  - mine    : 내가 예약한 슬롯
 *  - taken   : 타 기업 점유 또는 취소(마감)
 *  - blocked : 빈 슬롯이지만 예약 단계 아님/한도·중복·충돌로 신청 불가
 *  - open    : 지금 신청 가능
 */
export type CellState = 'open' | 'blocked' | 'taken' | 'mine' | 'none';

/** 슬롯의 표시 상태를 판정한다(예약 가능/내 예약/마감/신청 불가). */
export function cellStateOf(
  slot: MatchingSlotRow | undefined,
  allSlots: MatchingSlotRow[],
  myId: string,
  maxSessions: number,
  canBook: boolean,
  allowDuplicateExpert: boolean,
): CellState {
  if (!slot) return 'none';
  if (isMine(slot, myId)) return 'mine';
  if (!isAvailable(slot)) return 'taken';
  if (!canBook) return 'blocked';
  return bookingBlockReason(allSlots, slot, myId, maxSessions, { allowDuplicateExpert })
    ? 'blocked'
    : 'open';
}
