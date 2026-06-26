-- =============================================================================
-- 0020_clear_attendance.sql — 출석 기록 삭제(미정으로 되돌리기) RPC
-- 출처: docs/page_admin_event_detail.md §3.1, docs/db_schema.md §4.5
-- =============================================================================
-- attendance_status 는 PRESENT|ABSENT 만 있어 "미정" 값이 없다. 실수로 출석/불참을
-- 누른 경우 기본(미정) 상태로 되돌리려면 해당 (슬롯,사용자,역할)의 출석 로그를 삭제한다.
-- 권한 규칙은 check_in(0019)과 동일: 전문가 출석=본인 또는 ADMIN/STAFF 대리,
-- 스타트업 출석=ADMIN/STAFF 또는 담당 전문가. 대상은 반드시 해당 슬롯의 당사자.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.clear_attendance(
    p_slot_id UUID,
    p_user_id UUID,
    p_role_type TEXT
)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_role TEXT := public.current_app_role();
    v_slot public.matching_slots%ROWTYPE;
BEGIN
    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id;
    IF v_slot.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;

    IF p_role_type = 'EXPERT' THEN
        IF v_slot.expert_id <> p_user_id THEN
            RAISE EXCEPTION '해당 슬롯의 전문가가 아닙니다.';
        END IF;
        IF NOT (v_uid = p_user_id OR v_role IN ('ADMIN', 'STAFF')) THEN
            RAISE EXCEPTION '전문가 출석은 본인 또는 관리자/스태프만 처리할 수 있습니다.';
        END IF;
    ELSIF p_role_type = 'STARTUP' THEN
        IF NOT (v_role IN ('ADMIN', 'STAFF') OR (v_role = 'EXPERT' AND v_slot.expert_id = v_uid)) THEN
            RAISE EXCEPTION '스타트업 출석은 관리자/스태프 또는 담당 전문가만 처리할 수 있습니다.';
        END IF;
        IF v_slot.startup_id <> p_user_id THEN
            RAISE EXCEPTION '해당 슬롯의 스타트업이 아닙니다.';
        END IF;
    ELSE
        RAISE EXCEPTION '잘못된 역할 유형입니다.';
    END IF;

    DELETE FROM public.attendance_logs
    WHERE matching_slot_id = p_slot_id
      AND user_id = p_user_id
      AND role_type = p_role_type;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_attendance(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_attendance(UUID, UUID, TEXT) TO authenticated;
