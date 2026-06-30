/**
 * 예약 현황·충돌 판정 순수 함수 (page_admin_event_detail.md §2.2, §3.2, db_schema §4.1).
 * 화면/모달이 호출하는 계산 로직을 DB 와 동일한 규칙으로 분리해 단위 테스트한다.
 * (DB RPC `_validate_slot_assignment` 가 최종 권위. 여기서는 사전 안내·비활성 처리용.)
 */

import type { BookingStats, MatchingSlotRow, ProgressStats } from '@/types/eventDetail';

/** 취소가 아닌 실제 예약(스타트업 배정) 슬롯인가. */
function isBooked(slot: MatchingSlotRow): boolean {
  return slot.startup_id !== null && slot.session_status !== 'CANCELLED';
}

/**
 * 진행관리 통계 계산 (page_admin_event_detail.md §3.1).
 * 기준은 "예약된 세션"(취소 제외 + 스타트업 배정)이며, 진행 상태별로 집계한다.
 * 잔여 세션 = 아직 끝나지 않은 세션(대기중 + 진행중) = 총 − 완료 − 불참(노쇼).
 */
export function computeProgressStats(slots: MatchingSlotRow[]): ProgressStats {
  const booked = slots.filter(isBooked);
  const waiting = booked.filter((s) => s.session_status === 'WAITING').length;
  const inProgress = booked.filter((s) => s.session_status === 'IN_PROGRESS').length;
  const completed = booked.filter((s) => s.session_status === 'COMPLETED').length;
  const noShow = booked.filter((s) => s.session_status === 'NO_SHOW').length;
  return {
    total: booked.length,
    waiting,
    inProgress,
    completed,
    remaining: waiting + inProgress,
    noShow,
  };
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
 * 예약 현황 통계 계산. 지표의 기준은 "슬롯(공급)"이 아니라 "필요 세션(수요)"이다.
 * 공급(전체 슬롯)은 전문가 가용 시간으로 정해지므로, 충족률을 슬롯으로 나누면
 * 모든 기업이 목표를 다 채워도 잉여 슬롯 탓에 100%에 못 미친다(역으로 공급이 모자라면
 * 100%여도 미충족 기업이 남는다). 그래서 분모를 목표 수요(기업 수 × 기업당 횟수)로 둔다.
 * @param slots 행사의 전체 매칭 슬롯
 * @param startupUserIds 행사에 참가 등록된 스타트업 user_id 목록
 * @param maxSessions 기업당 진행 횟수(events.max_sessions_per_startup)
 */
export function computeBookingStats(
  slots: MatchingSlotRow[],
  startupUserIds: string[],
  maxSessions: number,
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

  const startupCount = startupUserIds.length;
  const requiredSessions = startupCount * maxSessions;
  // 부호 있는 잔여: 공급(전체 슬롯) − 수요(목표 세션). 예약분은 양쪽에서 상쇄되므로
  // 양수면 남은 빈 슬롯으로 목표를 채울 수 있고(예약 가능), 음수면 슬롯을 더 열어야 한다.
  const slotBalance = totalSlots - requiredSessions;

  return {
    totalSlots,
    bookedSlots,
    emptySlots,
    startupCount,
    maxSessions,
    requiredSessions,
    slotBalance,
    bookingRate: requiredSessions === 0 ? 0 : bookedSlots / requiredSessions,
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
 * 예약 배치 현황 매트릭스 (page_admin_event_detail.md §2.2 보강 — 전문가×시간 표).
 * 취소되지 않은 슬롯을 열=시작시각, 행=전문가로 묶어 셀에서 슬롯을 찾을 수 있게 한다.
 * @returns columns 시작시각(ISO) 오름차순, byExpert expert_id→(startIso→slot)
 */
export function buildBookingSchedule(slots: MatchingSlotRow[]): {
  columns: string[];
  byExpert: Map<string, Map<string, MatchingSlotRow>>;
} {
  const colSet = new Set<string>();
  const byExpert = new Map<string, Map<string, MatchingSlotRow>>();
  for (const s of slots) {
    if (s.session_status === 'CANCELLED') continue;
    colSet.add(s.start_time);
    let row = byExpert.get(s.expert_id);
    if (!row) {
      row = new Map<string, MatchingSlotRow>();
      byExpert.set(s.expert_id, row);
    }
    row.set(s.start_time, s);
  }
  const columns = [...colSet].sort((a, b) => a.localeCompare(b));
  return { columns, byExpert };
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

/**
 * 선택한 스타트업이 이미 예약한 시간대와 겹쳐 배정 불가한 빈 슬롯 id 집합.
 * 강제 배정(스타트업 → 전문가) 모달에서 후보 슬롯을 비활성 처리할 때 쓴다.
 * 동시간 중복은 관리자도 우회 불가하므로(db_schema §4.3) 회색 처리한다.
 */
export function conflictingSlotIdsForStartup(
  slots: MatchingSlotRow[],
  startupId: string,
): Set<string> {
  const busy = slots.filter((s) => isBooked(s) && s.startup_id === startupId);
  const conflicting = new Set<string>();
  if (busy.length === 0) return conflicting;
  for (const s of slots) {
    if (s.startup_id !== null) continue; // 빈(배정 가능) 슬롯만 대상
    if (busy.some((b) => overlaps(s.start_time, s.end_time, b.start_time, b.end_time))) {
      conflicting.add(s.id);
    }
  }
  return conflicting;
}
