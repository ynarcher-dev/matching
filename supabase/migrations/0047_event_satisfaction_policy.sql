-- =============================================================================
-- 0047_event_satisfaction_policy.sql — 행사별 만족도 수집 정책 (Phase 8-D)
-- 출처: docs/functional_followup_plan.md T4/T6, docs/development_status.md 8-D
-- =============================================================================
-- 2026-06-28 기획 확정(사용자 합의):
--   행사 기본 설정에 만족도 수집 단위를 선택하는 정책을 추가한다.
--     EVENT_ONLY  — 행사 전체 만족도만 수집(현재 동작)
--     EXPERT_ONLY — 상담 전문가별 만족도만 수집
--     BOTH        — 둘 다 수집
--     NONE        — 수집 안 함
--
--   기본값/backfill: 신규·기존 행사 모두 EVENT_ONLY (현재 동작 100% 보존).
--   전문가별(EXPERT_ONLY/BOTH) 만족도의 실제 수집·집계 UI 는 8-G 에서 구현하며,
--   이 마이그레이션은 정책 컬럼만 추가한다.
--
-- 정합 메모:
--   * NOT NULL DEFAULT 'EVENT_ONLY' 로 기존 행사는 자동 backfill 된다.
--   * CHECK 제약으로 프론트 enum 과 동기화한다.
-- =============================================================================

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS satisfaction_policy TEXT NOT NULL DEFAULT 'EVENT_ONLY';

ALTER TABLE public.events
    DROP CONSTRAINT IF EXISTS chk_satisfaction_policy;

ALTER TABLE public.events
    ADD CONSTRAINT chk_satisfaction_policy
    CHECK (satisfaction_policy IN ('EVENT_ONLY', 'EXPERT_ONLY', 'BOTH', 'NONE'));
