-- =============================================================================
-- 0050_start_counseling_admin.sql — start_counseling: 관리자/스태프 대리 시작 허용
-- 출처: docs/page_admin_event_detail.md §3.1 (진행 대시보드)
-- =============================================================================
-- 변경: 기존(0005)은 상담 시작(WAITING→IN_PROGRESS)을 "전문가 본인만" 허용했다.
--       그 결과 관리자 진행 대시보드에서는 세션을 진행중으로 넘길 수단이 없어
--       진행현황(세션 상태)이 반영되지 않았다.
--       → 0019(출석 대리)와 동일하게, 상담 시작을 (전문가 본인) OR (해당 행사 관리/스태프
--         권한자 = can_staff_event)로 확장한다. 나머지 가드(WAITING·PROGRESS)는 유지.
--       세션 완료(COMPLETED)는 여전히 전문가의 상담일지 제출(submit_counseling_log)로만
--       이뤄진다(스코어카드 데이터 보존).
-- =============================================================================
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
    -- 본인(전문가) 또는 해당 행사 관리/스태프 권한자가 시작할 수 있다.
    IF NOT (v_slot.expert_id = v_uid OR public.can_staff_event(v_slot.event_id)) THEN
        RAISE EXCEPTION '본인 세션 또는 관리/스태프 권한이 있어야 상담을 시작할 수 있습니다.';
    END IF;
    IF v_slot.startup_id IS NULL THEN RAISE EXCEPTION '예약되지 않은 슬롯입니다.'; END IF;
    IF v_slot.session_status <> 'WAITING' THEN
        RAISE EXCEPTION '대기(WAITING) 상태에서만 상담을 시작할 수 있습니다. (현재: %)', v_slot.session_status;
    END IF;

    SELECT status INTO v_status FROM public.events WHERE id = v_slot.event_id;
    IF v_status <> 'PROGRESS' THEN RAISE EXCEPTION '진행(PROGRESS) 단계에서만 상담을 시작할 수 있습니다.'; END IF;

    UPDATE public.matching_slots SET session_status = 'IN_PROGRESS' WHERE id = p_slot_id;
    RETURN p_slot_id;
END;
$$;
REVOKE ALL ON FUNCTION public.start_counseling(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_counseling(UUID) TO authenticated;
