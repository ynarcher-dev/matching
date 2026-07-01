-- =============================================================================
-- 0066_split_view_request_and_start_attendance.sql
--   전문가 Split View 상담 워크스페이스 (docs/expert_dashboard_split_view_ideation.md)
-- =============================================================================
-- 1) matching_slots.counseling_request — 스타트업이 입력하는 '상담 희망사항'
--    (간단한 고민거리·자문받고 싶은 핵심 질문). Split View 좌측 [요청] 탭에 노출(§3②).
-- 2) set_counseling_request RPC — 스타트업 본인 예약 슬롯에만 희망사항을 저장.
-- 3) start_counseling — 상담 시작 시 전문가·스타트업을 자동 출석(PRESENT) 처리(§4).
--    관리자 측 자동 출석(0062 _sync_session_attendance)과 동일한 헬퍼를 재사용한다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 상담 희망사항 컬럼
-- -----------------------------------------------------------------------------
ALTER TABLE public.matching_slots
    ADD COLUMN IF NOT EXISTS counseling_request TEXT;

COMMENT ON COLUMN public.matching_slots.counseling_request IS
    '스타트업이 입력한 상담 희망사항(고민거리·핵심 질문). Split View 좌측 [요청] 탭 노출.';

-- -----------------------------------------------------------------------------
-- 2. 상담 희망사항 저장 RPC (스타트업 본인 예약만)
--    행사 종료(FINISHED) 전까지, 본인이 배정된 슬롯에 한해 수정 가능. 빈 문자열은 NULL.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_counseling_request(
    p_slot_id UUID,
    p_request TEXT
)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_slot public.matching_slots%ROWTYPE;
    v_event_status TEXT;
    v_clean TEXT := NULLIF(btrim(COALESCE(p_request, '')), '');
BEGIN
    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id FOR UPDATE;
    IF v_slot.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;
    IF v_slot.startup_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION '본인 예약의 상담 희망사항만 수정할 수 있습니다.';
    END IF;

    SELECT status INTO v_event_status FROM public.events WHERE id = v_slot.event_id;
    IF v_event_status = 'FINISHED' THEN
        RAISE EXCEPTION '종료된 행사의 상담 희망사항은 수정할 수 없습니다.';
    END IF;

    IF v_clean IS NOT NULL AND char_length(v_clean) > 1000 THEN
        RAISE EXCEPTION '상담 희망사항은 1000자 이하로 입력해 주세요.';
    END IF;

    UPDATE public.matching_slots SET counseling_request = v_clean WHERE id = p_slot_id;
    RETURN p_slot_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_counseling_request(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_counseling_request(UUID, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2-1. 참고 URL(홈페이지·웹 IR) 저장 RPC (스타트업 본인 users 행)
--      Split View 좌측 [링크] 탭 노출용. 본인 행만, 길이 255 이하, 빈 값은 NULL.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_my_company_homepage(p_homepage TEXT)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_clean TEXT := NULLIF(btrim(COALESCE(p_homepage, '')), '');
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION '인증이 필요합니다.'; END IF;
    IF v_clean IS NOT NULL AND char_length(v_clean) > 255 THEN
        RAISE EXCEPTION '참고 URL 은 255자 이하로 입력해 주세요.';
    END IF;
    UPDATE public.users SET company_homepage = v_clean WHERE id = v_uid;
END;
$$;
REVOKE ALL ON FUNCTION public.set_my_company_homepage(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_company_homepage(TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. 상담 시작 + 자동 출석 (전문가 본인, WAITING → IN_PROGRESS)
--    기존 0005 의 본문에 출석 자동 동기화(§4 행동 기반 자동 출석)를 더한다.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_counseling(p_slot_id UUID)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_slot public.matching_slots%ROWTYPE;
    v_status TEXT;
BEGIN
    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id FOR UPDATE;
    IF v_slot.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;
    IF v_slot.expert_id <> v_uid THEN RAISE EXCEPTION '본인 세션만 시작할 수 있습니다.'; END IF;
    IF v_slot.startup_id IS NULL THEN RAISE EXCEPTION '예약되지 않은 슬롯입니다.'; END IF;
    IF v_slot.session_status <> 'WAITING' THEN
        RAISE EXCEPTION '대기(WAITING) 상태에서만 상담을 시작할 수 있습니다. (현재: %)', v_slot.session_status;
    END IF;

    SELECT status INTO v_status FROM public.events WHERE id = v_slot.event_id;
    IF v_status <> 'PROGRESS' THEN RAISE EXCEPTION '진행(PROGRESS) 단계에서만 상담을 시작할 수 있습니다.'; END IF;

    UPDATE public.matching_slots SET session_status = 'IN_PROGRESS' WHERE id = p_slot_id;

    -- 행동 기반 자동 출석(§4): 전문가·스타트업 모두 PRESENT 로 동기화(0062 헬퍼 재사용).
    PERFORM public._sync_session_attendance(
        p_slot_id, v_slot.expert_id, 'EXPERT', TRUE, v_uid, '상담 시작 자동 출석');
    PERFORM public._sync_session_attendance(
        p_slot_id, v_slot.startup_id, 'STARTUP', TRUE, v_uid, '상담 시작 자동 출석');

    RETURN p_slot_id;
END;
$$;
REVOKE ALL ON FUNCTION public.start_counseling(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_counseling(UUID) TO authenticated;
