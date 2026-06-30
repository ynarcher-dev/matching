-- =============================================================================
-- 0062_status_drives_attendance.sql — 진행 상태가 출석을 자동 갱신
-- 출처: docs/counseling_management_ideation.md §1 (출석 기능 제거 → 상태 버튼 통합)
-- =============================================================================
-- 배경: 진행 대시보드(TimeGridSheet) 셀에서 운영자가 (1) 전문가/스타트업 출석을 따로
--       마킹하고 (2) 진행 상태(대기/진행/완료/노쇼)를 또 선택해야 해서 이중 관리였다.
-- 변경: 출석 마킹 UI 를 없애고, 진행 상태 전환 시점에 출석 로그를 자동으로 동기화한다.
--       - IN_PROGRESS / COMPLETED → 전문가·스타트업 모두 PRESENT(자동 출석)
--       - WAITING                 → 두 참가자 출석 로그 삭제(미정으로 복귀)
--       - NO_SHOW                 → 스타트업 ABSENT(불참). 전문가 출석은 보존한다
--         (전문가는 통상 착석해 있고, 누가 노쇼냈는지 구분 정보가 없어 startup 만 표시).
--       attendance_logs 는 append-only(최신 우선)이므로 PRESENT 는 INSERT, 미정 복귀는
--       기존 check_in/clear_attendance 와 동일하게 DELETE 로 처리한다.
--       만족도·통계가 참조하는 attendance 데이터 호환성을 그대로 유지한다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 내부 헬퍼: 진행 상태에 맞춰 (슬롯,참가자) 출석 로그를 동기화한다.
--   p_present = TRUE  → PRESENT 로그 INSERT(append-only)
--   p_present = FALSE → 해당 참가자 출석 로그 DELETE(미정 복귀)
-- check_in_type 은 'MANUAL'(QR|MANUAL 제약), 사유는 상태 전환 출처를 남긴다.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._sync_session_attendance(
    p_slot_id UUID,
    p_user_id UUID,
    p_role_type TEXT,
    p_present BOOLEAN,
    p_actor_id UUID,
    p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF p_user_id IS NULL THEN RETURN; END IF;

    IF p_present THEN
        -- 이미 PRESENT 면 중복 기록을 남기지 않는다(append-only 잡음 최소화).
        IF public._latest_attendance_status(p_slot_id, p_user_id) IS DISTINCT FROM 'PRESENT' THEN
            INSERT INTO public.attendance_logs
                (matching_slot_id, user_id, role_type, attendance_status, check_in_type, checked_in_by, reason)
            VALUES (p_slot_id, p_user_id, p_role_type, 'PRESENT', 'MANUAL', p_actor_id, p_reason);
        END IF;
    ELSE
        DELETE FROM public.attendance_logs
        WHERE matching_slot_id = p_slot_id AND user_id = p_user_id AND role_type = p_role_type;
    END IF;
END;
$$;

-- (슬롯,사용자) 최신 출석 상태 판정(없으면 NULL). _sync_session_attendance 중복 가드용.
CREATE OR REPLACE FUNCTION public._latest_attendance_status(p_slot_id UUID, p_user_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT attendance_status
    FROM public.attendance_logs
    WHERE matching_slot_id = p_slot_id AND user_id = p_user_id
    ORDER BY checked_in_at DESC
    LIMIT 1;
$$;

-- -----------------------------------------------------------------------------
-- admin_set_session_status: 상태 전환 + 출석 자동 동기화
-- -----------------------------------------------------------------------------
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
    v_att_reason TEXT;
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

    -- 출석 자동 동기화(ideation §1): 진행/완료=출석, 대기=미정 복귀.
    v_att_reason := '진행 상태(' || p_status || ') 전환 자동 출석';
    IF p_status IN ('IN_PROGRESS', 'COMPLETED') THEN
        PERFORM public._sync_session_attendance(p_slot_id, v_slot.expert_id, 'EXPERT', TRUE, v_uid, v_att_reason);
        PERFORM public._sync_session_attendance(p_slot_id, v_slot.startup_id, 'STARTUP', TRUE, v_uid, v_att_reason);
    ELSIF p_status = 'WAITING' THEN
        PERFORM public._sync_session_attendance(p_slot_id, v_slot.expert_id, 'EXPERT', FALSE, v_uid, v_att_reason);
        PERFORM public._sync_session_attendance(p_slot_id, v_slot.startup_id, 'STARTUP', FALSE, v_uid, v_att_reason);
    END IF;

    RETURN p_slot_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_session_status(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_session_status(UUID, TEXT, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- mark_no_show: 노쇼 처리 + 스타트업 불참(ABSENT) 자동 기록
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_no_show(p_slot_id UUID, p_reason TEXT)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_slot public.matching_slots%ROWTYPE;
BEGIN
    IF public.current_app_role() <> 'ADMIN' THEN RAISE EXCEPTION '노쇼 처리는 관리자만 가능합니다.'; END IF;
    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id FOR UPDATE;
    IF v_slot.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;
    IF v_slot.session_status NOT IN ('WAITING', 'IN_PROGRESS') THEN
        RAISE EXCEPTION '대기/진행 상태에서만 노쇼 처리할 수 있습니다. (현재: %)', v_slot.session_status;
    END IF;

    UPDATE public.matching_slots SET session_status = 'NO_SHOW' WHERE id = p_slot_id;

    INSERT INTO public.booking_history (matching_slot_id, action_type, actor_id, startup_id, expert_id, previous_slot_info, reason)
    VALUES (p_slot_id, 'NO_SHOW', v_uid, v_slot.startup_id, v_slot.expert_id, public._slot_snapshot(v_slot), p_reason);
    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, old_values, reason)
    VALUES (v_uid, 'MARK_NO_SHOW', 'matching_slots', p_slot_id, public._slot_snapshot(v_slot), p_reason);

    -- 노쇼 = 스타트업 불참. 출석 로그를 ABSENT 로 기록(전문가 출석은 보존, ideation §1).
    INSERT INTO public.attendance_logs
        (matching_slot_id, user_id, role_type, attendance_status, check_in_type, checked_in_by, reason)
    VALUES (p_slot_id, v_slot.startup_id, 'STARTUP', 'ABSENT', 'MANUAL', v_uid, '노쇼 처리 자동 불참: ' || p_reason);

    RETURN p_slot_id;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_no_show(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_no_show(UUID, TEXT) TO authenticated;
