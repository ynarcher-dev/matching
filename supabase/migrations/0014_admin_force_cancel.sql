-- =============================================================================
-- 0014_admin_force_cancel.sql — 관리자 강제 예약 취소 RPC (단일 트랜잭션)
-- 출처: docs/page_admin_event_detail.md 3.2 (강제 변경·취소는 RPC + booking_history + audit_logs)
-- =============================================================================
-- admin_force_assign(0004)의 짝. 점유된 슬롯의 스타트업 배정을 해제(슬롯은 즉시 공개)
-- 하고 booking_history(CANCELLED) + audit_logs 에 기록한다. 관리자 전용·사유 필수.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_force_cancel(p_slot_id UUID, p_reason TEXT)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_slot public.matching_slots%ROWTYPE;
    v_prev JSONB;
BEGIN
    IF public.current_app_role() <> 'ADMIN' THEN
        RAISE EXCEPTION '강제 취소는 관리자만 가능합니다.';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
        RAISE EXCEPTION '강제 취소 사유는 필수입니다.';
    END IF;

    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id FOR UPDATE;
    IF v_slot.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;
    IF v_slot.startup_id IS NULL THEN RAISE EXCEPTION '예약이 없는 슬롯입니다.'; END IF;
    v_prev := public._slot_snapshot(v_slot);

    -- 슬롯 즉시 공개(별도 Hold 없음). 세션 상태는 기본 WAITING 으로 되돌린다.
    UPDATE public.matching_slots
    SET startup_id = NULL, booking_type = 'NONE', session_status = 'WAITING'
    WHERE id = p_slot_id;

    INSERT INTO public.booking_history (matching_slot_id, action_type, actor_id, startup_id, expert_id, previous_slot_info, reason)
    VALUES (p_slot_id, 'CANCELLED', v_uid, v_slot.startup_id, v_slot.expert_id, v_prev, p_reason);

    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, old_values, new_values, reason)
    VALUES (v_uid, 'FORCE_CANCEL', 'matching_slots', p_slot_id, v_prev,
            public._slot_snapshot((SELECT s FROM public.matching_slots s WHERE s.id = p_slot_id)), p_reason);

    RETURN p_slot_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_force_cancel(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_force_cancel(UUID, TEXT) TO authenticated;
