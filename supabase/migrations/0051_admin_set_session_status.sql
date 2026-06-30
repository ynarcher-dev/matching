-- =============================================================================
-- 0051_admin_set_session_status.sql — 관리자 진행 상태 전체 제어
-- 출처: docs/page_admin_event_detail.md §3.1 (진행 대시보드)
-- =============================================================================
-- 배경: 진행 상태(WAITING→IN_PROGRESS→COMPLETED)는 전문가 흐름(start_counseling /
--       submit_counseling_log)으로만 바뀌어, 관리자 진행 대시보드에서 전 단계를
--       직접 제어할 수 없었다.
-- 변경: 해당 행사 관리/스태프 권한자(can_staff_event)가 진행 상태를 직접 설정할 수 있는
--       admin_set_session_status 를 추가한다. 대기중↔진행중↔완료 자유 전환(노쇼 되돌리기
--       포함). NO_SHOW 는 사유·감사가 필요하므로 기존 mark_no_show, 취소는 cancel_session
--       을 사용한다(여기서는 WAITING/IN_PROGRESS/COMPLETED 만 허용).
--       완료(COMPLETED)는 관리자 운영 오버라이드로, 전문가 상담일지 없이도 설정 가능하다
--       (전문가 일지는 별도 submit_counseling_log 로 계속 작성). 모든 변경은 audit_logs 기록.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.admin_set_session_status(
    p_slot_id UUID,
    p_status TEXT,
    p_reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_slot public.matching_slots%ROWTYPE;
    v_event_status TEXT;
BEGIN
    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id FOR UPDATE;
    IF v_slot.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;
    IF NOT public.can_staff_event(v_slot.event_id) THEN
        RAISE EXCEPTION '진행 상태 변경은 해당 행사 관리/스태프 권한자만 가능합니다.';
    END IF;
    IF v_slot.startup_id IS NULL THEN RAISE EXCEPTION '예약되지 않은 슬롯입니다.'; END IF;
    IF p_status NOT IN ('WAITING', 'IN_PROGRESS', 'COMPLETED') THEN
        RAISE EXCEPTION '허용되지 않는 상태입니다. (노쇼는 mark_no_show, 취소는 cancel_session 사용)';
    END IF;

    SELECT status INTO v_event_status FROM public.events WHERE id = v_slot.event_id;
    IF v_event_status <> 'PROGRESS' THEN
        RAISE EXCEPTION '진행(PROGRESS) 단계에서만 진행 상태를 변경할 수 있습니다.';
    END IF;

    IF v_slot.session_status = p_status THEN
        RETURN p_slot_id; -- 변경 없음(멱등).
    END IF;

    UPDATE public.matching_slots SET session_status = p_status WHERE id = p_slot_id;

    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, old_values, new_values, reason)
    VALUES (
        v_uid,
        'SET_SESSION_STATUS',
        'matching_slots',
        p_slot_id,
        public._slot_snapshot(v_slot),
        jsonb_build_object('session_status', p_status),
        COALESCE(NULLIF(btrim(p_reason), ''), '관리자 대시보드 진행 상태 변경')
    );

    RETURN p_slot_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_session_status(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_session_status(UUID, TEXT, TEXT) TO authenticated;
