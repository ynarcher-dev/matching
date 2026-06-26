/**
 * AI 자동배치 제안 표시·사전 충돌 판정 순수 함수
 * (page_admin_ai_allocation.md §2 — 미리보기 컬러/충돌 안내).
 * 확정의 최종 권위는 DB confirm_ai_proposals + _validate_slot_assignment 이며,
 * 본 모듈은 화면 색상·경고·요약을 DB 와 같은 규칙으로 계산한다(단위 테스트 대상).
 */

import { overlaps } from '@/lib/booking';
import type { MatchingSlotRow } from '@/types/eventDetail';
import type { MatchingProposalRow } from '@/types/aiAllocation';

/** score(0~100+) 를 적합도 퍼센트(0~100 정수)로 표시. */
export function scorePercent(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export interface ProposalSummary {
  /** 슬롯에 배정된 제안 수. */
  matched: number;
  /** 미배치(사유만 있는) 제안 수. */
  unmatched: number;
  /** 배정됐지만 분야가 불일치하는(차선) 제안 수. */
  fieldMismatch: number;
  /** 관리자가 잠근 제안 수. */
  locked: number;
}

/** 제안 묶음의 요약 카운트. */
export function summarizeProposals(proposals: MatchingProposalRow[]): ProposalSummary {
  let matched = 0;
  let unmatched = 0;
  let fieldMismatch = 0;
  let locked = 0;
  for (const p of proposals) {
    if (p.target_slot_id) {
      matched += 1;
      if (!p.field_matched) fieldMismatch += 1;
    } else {
      unmatched += 1;
    }
    if (p.is_locked) locked += 1;
  }
  return { matched, unmatched, fieldMismatch, locked };
}

/**
 * 확정 시 충돌이 예상되는 제안인가(붉은 보더 사전 안내).
 * - 대상 슬롯이 사라졌거나 이미 다른 예약으로 점유됨
 * - 해당 스타트업이 동시간대에 이미 확정 예약을 가짐
 * (분야 불일치는 충돌이 아니라 경고로 별도 표기한다.)
 */
export function proposalHasConflict(
  proposal: MatchingProposalRow,
  slotById: Map<string, MatchingSlotRow>,
  slots: MatchingSlotRow[],
): boolean {
  if (!proposal.target_slot_id) return false;
  const target = slotById.get(proposal.target_slot_id);
  if (!target) return true;
  if (target.startup_id && target.session_status !== 'CANCELLED') return true;

  for (const s of slots) {
    if (s.id === target.id) continue;
    if (s.startup_id !== proposal.startup_id) continue;
    if (s.session_status === 'CANCELLED') continue;
    if (overlaps(target.start_time, target.end_time, s.start_time, s.end_time)) return true;
  }
  return false;
}

/** 빈(미예약·대기) 슬롯만 추린다 — 제안 이동(다른 빈 슬롯으로) 후보. */
export function emptySlots(slots: MatchingSlotRow[]): MatchingSlotRow[] {
  return slots.filter((s) => s.startup_id === null && s.session_status === 'WAITING');
}
