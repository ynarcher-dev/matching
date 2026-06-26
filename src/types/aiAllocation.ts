/**
 * AI 자동배치 제안 도메인 타입 (docs/db_schema.md §2.12 matching_proposals,
 * docs/page_admin_ai_allocation.md). 제안 조회·생성·확정에서 쓰는 행/요약 모델.
 */

/** matching_proposals 한 행. target_slot_id 가 NULL 이면 미배치(사유 보유) 제안. */
export interface MatchingProposalRow {
  id: string;
  event_id: string;
  target_slot_id: string | null;
  startup_id: string;
  score: number;
  field_matched: boolean;
  unmatched_reason: string | null;
  is_locked: boolean;
}

/** generate_ai_proposals RPC 반환 요약. */
export interface GenerateSummary {
  matched: number;
  unmatched: number;
  locked: number;
  empty_slots: number;
}

/** confirm_ai_proposals 가 건별로 건너뛴 충돌 항목. */
export interface ConfirmConflict {
  proposal_id: string;
  startup_id: string;
  slot_id: string;
  reason: string;
}

/** confirm_ai_proposals RPC 반환 리포트(부분 확정 결과). */
export interface ConfirmResult {
  applied: number;
  skipped: number;
  conflicts: ConfirmConflict[];
}
