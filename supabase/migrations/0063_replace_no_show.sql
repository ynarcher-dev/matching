-- =============================================================================
-- 0063_replace_no_show.sql — 노쇼 발생 시 현장 대체 매칭 (ideation §2, 안1 정신 — 슬롯 재사용형)
-- =============================================================================
-- 배경: 노쇼가 나면 그 전문가의 50분 슬롯이 비는데, 현장 대기 스타트업을 즉시 재배정하고 싶다.
-- 결정(ideation §2): 그리드는 (전문가×시작시각)당 비-CANCELLED 슬롯 1개만 그리고
--   (buildBookingSchedule), _validate_slot_assignment 의 전문가/테이블 동시간 충돌 검사가
--   같은 칸의 NO_SHOW 슬롯을 점유로 보므로, "문자 그대로의 안1(NO_SHOW 보존 + 슬롯 복제)"은
--   그리드/검증을 모두 손대야 한다. 대신 같은 슬롯을 재사용해 새 스타트업을 배정한다.
--   노쇼 통계/히스토리는 mark_no_show 가 이미 booking_history(NO_SHOW)+audit_logs 에 영구
--   기록하므로 안1 의 목적(히스토리 보존)은 그대로 충족된다.
--
-- 추가로: 0062 가 mark_no_show 의 권한 가드를 0043 의 can_staff_event(스태프+) 에서
--   current_app_role()='ADMIN'(관리자 전용)으로 좁힌 회귀가 있어 여기서 복구한다.
--   (0062 가 더한 스타트업 ABSENT 자동 불참 기록은 유지한다.)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- mark_no_show 복구: can_staff_event 가드(0043) + 스타트업 ABSENT 자동 기록(0062)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_no_show(p_slot_id UUID, p_reason TEXT)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_slot public.matching_slots%ROWTYPE;
BEGIN
    IF NOT public.can_staff_event((SELECT event_id FROM public.matching_slots WHERE id = p_slot_id)) THEN
        RAISE EXCEPTION '노쇼 처리는 해당 행사 관리/스태프 권한자만 가능합니다.';
    END IF;
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

-- -----------------------------------------------------------------------------
-- replace_no_show: 노쇼 슬롯에 현장 대기 스타트업을 신규 배정(슬롯 재사용형 대체 매칭)
--   - 권한: can_staff_event(현장 스태프+) — 노쇼/출석과 같은 현장 성격.
--   - 대상 슬롯은 NO_SHOW 여야 한다(대기/진행/완료 슬롯은 대체 매칭 대상 아님).
--   - 기존 노쇼 startup 의 점유/출석(ABSENT)을 비우고, 새 스타트업으로 WAITING 재배정한다.
--     노쇼 자체는 booking_history(NO_SHOW)에 이미 남아 있으므로 히스토리는 보존된다.
--   - 동시간/테이블 충돌은 _validate_slot_assignment 가 검증(최대횟수만 우회 — 현장 강제 성격).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.replace_no_show(
    p_slot_id UUID,
    p_new_startup_id UUID,
    p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_slot public.matching_slots%ROWTYPE;
    v_prev JSONB;
BEGIN
    IF NOT public.can_staff_event((SELECT event_id FROM public.matching_slots WHERE id = p_slot_id)) THEN
        RAISE EXCEPTION '현장 대체 매칭은 해당 행사 관리/스태프 권한자만 가능합니다.';
    END IF;
    IF p_new_startup_id IS NULL THEN
        RAISE EXCEPTION '대체 매칭할 스타트업을 선택해 주세요.';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
        RAISE EXCEPTION '현장 대체 매칭 사유는 필수입니다.';
    END IF;

    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id FOR UPDATE;
    IF v_slot.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;
    IF v_slot.session_status <> 'NO_SHOW' THEN
        RAISE EXCEPTION '노쇼 처리된 슬롯만 현장 대체 매칭할 수 있습니다. (현재: %)', v_slot.session_status;
    END IF;
    v_prev := public._slot_snapshot(v_slot);

    -- 기존 노쇼 startup 의 출석 로그(ABSENT 등) 정리 — 슬롯을 새 스타트업에 넘기므로 깨끗이 비운다.
    -- (노쇼 사실은 booking_history 에 남아 있어 통계/감사에 영향 없음.)
    DELETE FROM public.attendance_logs WHERE matching_slot_id = p_slot_id;

    -- 점유 해제 후 새 스타트업 배정 검증(최대횟수 우회). 검증은 자기 슬롯(p_slot_id)을 제외하므로
    -- startup_id 를 비워둔 상태로 통과시킨 뒤 배정한다.
    UPDATE public.matching_slots
    SET startup_id = NULL, booking_type = 'NONE', session_status = 'WAITING'
    WHERE id = p_slot_id;
    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id;

    PERFORM public._validate_slot_assignment(v_slot, p_new_startup_id, TRUE);

    UPDATE public.matching_slots
    SET startup_id = p_new_startup_id, booking_type = 'ADMIN_FORCE', session_status = 'WAITING'
    WHERE id = p_slot_id;

    INSERT INTO public.booking_history (matching_slot_id, action_type, actor_id, startup_id, expert_id, previous_slot_info, new_slot_info, reason)
    VALUES (p_slot_id, 'CHANGED', v_uid, p_new_startup_id, v_slot.expert_id, v_prev,
            public._slot_snapshot((SELECT s FROM public.matching_slots s WHERE s.id = p_slot_id)),
            '노쇼 현장 대체 매칭: ' || p_reason);

    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, old_values, new_values, reason)
    VALUES (v_uid, 'REPLACE_NO_SHOW', 'matching_slots', p_slot_id, v_prev,
            public._slot_snapshot((SELECT s FROM public.matching_slots s WHERE s.id = p_slot_id)),
            p_reason);

    RETURN p_slot_id;
END;
$$;
REVOKE ALL ON FUNCTION public.replace_no_show(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_no_show(UUID, UUID, TEXT) TO authenticated;
