-- =============================================================================
-- 0019_check_in_expert_admin.sql — check_in: 전문가 출석 관리자/스태프 대리 허용
-- 출처: docs/page_admin_event_detail.md §3.1, docs/db_schema.md §4.5
-- =============================================================================
-- 변경: 기존(0005)은 전문가 출석을 "본인만" 허용했으나, 전문가 노쇼/현장 누락 시
--       관리자가 진행 대시보드에서 대리 관리할 수 있어야 한다.
--       → 전문가 출석을 (전문가 본인) OR (ADMIN|STAFF 대리)로 확장한다.
--       p_user_id 는 여전히 해당 슬롯의 전문가여야 한다(타 전문가 대리 불가).
--       스타트업 출석 규칙·MANUAL 사유 필수 규칙은 그대로 유지한다.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.check_in(
    p_slot_id UUID,
    p_user_id UUID,
    p_role_type TEXT,
    p_attendance_status TEXT DEFAULT 'PRESENT',
    p_check_in_type TEXT DEFAULT 'QR',
    p_reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_role TEXT := public.current_app_role();
    v_slot public.matching_slots%ROWTYPE;
    v_att_id UUID;
BEGIN
    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id;
    IF v_slot.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;

    IF p_role_type = 'EXPERT' THEN
        -- 전문가 출석: 본인 또는 관리자/스태프 대리. 대상은 반드시 해당 슬롯의 전문가.
        IF v_slot.expert_id <> p_user_id THEN
            RAISE EXCEPTION '해당 슬롯의 전문가가 아닙니다.';
        END IF;
        IF NOT (v_uid = p_user_id OR v_role IN ('ADMIN', 'STAFF')) THEN
            RAISE EXCEPTION '전문가 출석은 본인 또는 관리자/스태프만 처리할 수 있습니다.';
        END IF;
    ELSIF p_role_type = 'STARTUP' THEN
        -- 스타트업 출석은 관리자/스태프가 기본 처리.
        -- 단, 해당 슬롯 담당 전문가는 본인 대시보드 세션 카드에서 직접 확인·체크 가능.
        IF NOT (v_role IN ('ADMIN', 'STAFF') OR (v_role = 'EXPERT' AND v_slot.expert_id = v_uid)) THEN
            RAISE EXCEPTION '스타트업 출석은 관리자/스태프 또는 담당 전문가만 처리할 수 있습니다.';
        END IF;
        IF v_slot.startup_id <> p_user_id THEN
            RAISE EXCEPTION '해당 슬롯의 스타트업이 아닙니다.';
        END IF;
    ELSE
        RAISE EXCEPTION '잘못된 역할 유형입니다.';
    END IF;

    -- 수동 변경(오등록 수정)은 사유 필수
    IF p_check_in_type = 'MANUAL' AND (p_reason IS NULL OR length(btrim(p_reason)) = 0) THEN
        RAISE EXCEPTION '수동 출석 처리는 사유가 필요합니다.';
    END IF;

    INSERT INTO public.attendance_logs (matching_slot_id, user_id, role_type, attendance_status, check_in_type, checked_in_by, reason)
    VALUES (p_slot_id, p_user_id, p_role_type, p_attendance_status, p_check_in_type, v_uid, p_reason)
    RETURNING id INTO v_att_id;

    RETURN v_att_id;
END;
$$;
REVOKE ALL ON FUNCTION public.check_in(UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_in(UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
