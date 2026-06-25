/**
 * 예약 현황·충돌 판정 순수 함수 (page_admin_event_detail.md §2.2, §3.2, db_schema §4.1).
 * 화면/모달이 호출하는 계산 로직을 DB 와 동일한 규칙으로 분리해 단위 테스트한다.
 * (DB RPC `_validate_slot_assignment` 가 최종 권위. 여기서는 사전 안내·비활성 처리용.)
 */

import type { BookingStats, MatchingSlotRow } from '@/types/eventDetail';

/** 취소가 아닌 실제 예약(스타트업 배정) 슬롯인가. */
function isBooked(slot: MatchingSlotRow): boolean {
  return slot.startup_id !== null && slot.session_status !== 'CANCELLED';
}

/** 두 시간 범위가 겹치는가(start < otherEnd && end > otherStart). */
export function overlaps(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  return startA < endB && endA > startB;
}

/**
 * 예약 현황 통계 계산. 빈 슬롯/예약 슬롯 수와 예약율, 참가 스타트업 대비 미예약 수.
 * @param slots 행사의 전체 매칭 슬롯
 * @param startupUserIds 행사에 참가 등록된 스타트업 user_id 목록
 */
export function computeBookingStats(
  slots: MatchingSlotRow[],
  startupUserIds: string[],
): BookingStats {
  const active = slots.filter((s) => s.session_status !== 'CANCELLED');
  const totalSlots = active.length;
  const bookedSlots = active.filter(isBooked).length;
  const emptySlots = totalSlots - bookedSlots;

  const bookedSet = new Set<string>();
  for (const s of slots) {
    if (isBooked(s) && s.startup_id) bookedSet.add(s.startup_id);
  }
  const participantSet = new Set(startupUserIds);
  const bookedStartupCount = [...bookedSet].filter((id) => participantSet.has(id)).length;
  const unbookedStartupCount = startupUserIds.filter((id) => !bookedSet.has(id)).length;

  return {
    totalSlots,
    bookedSlots,
    emptySlots,
    bookingRate: totalSlots === 0 ? 0 : bookedSlots / totalSlots,
    bookedStartupCount,
    unbookedStartupCount,
  };
}

/** 예약이 0건인 참가 스타트업 user_id 목록(긴급 알림 대상). */
export function unbookedStartupIds(
  slots: MatchingSlotRow[],
  startupUserIds: string[],
): string[] {
  const bookedSet = new Set<string>();
  for (const s of slots) {
    if (isBooked(s) && s.startup_id) bookedSet.add(s.startup_id);
  }
  return startupUserIds.filter((id) => !bookedSet.has(id));
}

/**
 * 대상 슬롯 시간대에 이미 다른 예약을 가진 스타트업 id 집합(강제 배정 모달의 비활성 대상).
 * 동시간 중복은 관리자도 우회 불가하므로(db_schema §4.3) 후보에서 회색 처리한다.
 */
export function conflictingStartupIds(
  slots: MatchingSlotRow[],
  targetSlot: MatchingSlotRow,
): Set<string> {
  const conflicting = new Set<string>();
  for (const s of slots) {
    if (s.id === targetSlot.id) continue;
    if (!isBooked(s) || !s.startup_id) continue;
    if (overlaps(targetSlot.start_time, targetSlot.end_time, s.start_time, s.end_time)) {
      conflicting.add(s.startup_id);
    }
  }
  return conflicting;
}
