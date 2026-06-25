-- =============================================================================
-- 0013_fields_limit.sql — 분야(M:N) 최대 3개 제약 (Phase 4 슬라이스 3)
-- 출처: docs/db_schema.md §2.4/§2.5 ("각각 최대 3개까지 허용하며 RPC 또는 Trigger 에서 검증"),
--       docs/page_admin_user_management.md §2.4 (관심/전문 분야 최대 3개)
-- =============================================================================
-- user_fields(사용자 기본 분야)·event_participant_fields(행사별 분야)는 각각 대상당
-- 최대 3개까지만 허용한다. 관리자 화면은 "전체 삭제 후 선택분 INSERT" 패턴으로 동기화하므로
-- (다중 행 1 INSERT) 행 단위 BEFORE 카운트로는 같은 문장 내 신규 행이 보이지 않는다.
-- 따라서 문장 종료 시점에 모든 행이 반영된 AFTER ... FOR EACH ROW 에서 카운트한다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- user_fields: user_id 당 최대 3개
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_user_fields_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF (SELECT count(*) FROM public.user_fields WHERE user_id = NEW.user_id) > 3 THEN
        RAISE EXCEPTION '사용자 기본 분야는 최대 3개까지 지정할 수 있습니다.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_fields_limit ON public.user_fields;
CREATE TRIGGER trg_user_fields_limit
    AFTER INSERT ON public.user_fields
    FOR EACH ROW EXECUTE FUNCTION public.enforce_user_fields_limit();

-- -----------------------------------------------------------------------------
-- event_participant_fields: event_participant_id 당 최대 3개 (슬라이스 4 대비 선반영)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_epf_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF (SELECT count(*) FROM public.event_participant_fields
        WHERE event_participant_id = NEW.event_participant_id) > 3 THEN
        RAISE EXCEPTION '행사별 참가 분야는 최대 3개까지 지정할 수 있습니다.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_epf_limit ON public.event_participant_fields;
CREATE TRIGGER trg_epf_limit
    AFTER INSERT ON public.event_participant_fields
    FOR EACH ROW EXECUTE FUNCTION public.enforce_epf_limit();
