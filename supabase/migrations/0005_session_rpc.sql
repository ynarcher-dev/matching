-- =============================================================================
-- 0005_session_rpc.sql — 세션 진행/상담일지/출석 RPC
-- 출처: docs/db_schema.md 4.4~4.5, docs/page_expert_dashboard.md 2~4장,
--       docs/security_transactions.md 5장
-- =============================================================================
-- 세션 상태 전이: WAITING→IN_PROGRESS→COMPLETED / (WAITING|IN_PROGRESS)→NO_SHOW
--               / WAITING→CANCELLED
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 상담 시작 (전문가 본인, WAITING → IN_PROGRESS)
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
    RETURN p_slot_id;
END;
$$;
REVOKE ALL ON FUNCTION public.start_counseling(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_counseling(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. 상담일지 제출 + 세션 완료 (단일 트랜잭션)
--    최초 제출: INSERT + COMPLETED 전환. FINISHED 전 재제출: UPDATE + 감사로그.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_counseling_log(
    p_slot_id UUID,
    p_score_technology INT,
    p_score_expertise INT,
    p_score_reliability INT,
    p_score_collaboration INT,
    p_score_probability INT,
    p_content TEXT,
    p_follow_up_required BOOLEAN DEFAULT FALSE,
    p_follow_up_memo TEXT DEFAULT NULL,
    p_is_public BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_slot public.matching_slots%ROWTYPE;
    v_event_status TEXT;
    v_existing public.counseling_logs%ROWTYPE;
    v_log_id UUID;
BEGIN
    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id FOR UPDATE;
    IF v_slot.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;
    IF v_slot.expert_id <> v_uid THEN RAISE EXCEPTION '본인 세션의 일지만 작성할 수 있습니다.'; END IF;

    -- 최종 제출 검증: 5개 점수만 필수. 코멘트 길이 제한 없음(임시저장 허용).
    IF p_score_technology IS NULL OR p_score_expertise IS NULL OR p_score_reliability IS NULL
       OR p_score_collaboration IS NULL OR p_score_probability IS NULL THEN
        RAISE EXCEPTION '최종 제출에는 5개 평가 점수를 모두 입력해야 합니다.';
    END IF;

    SELECT status INTO v_event_status FROM public.events WHERE id = v_slot.event_id;
    IF v_event_status = 'FINISHED' THEN
        RAISE EXCEPTION '종료된 행사의 상담일지는 수정할 수 없습니다.';
    END IF;

    SELECT * INTO v_existing FROM public.counseling_logs WHERE matching_slot_id = p_slot_id;

    IF v_existing.id IS NULL THEN
        INSERT INTO public.counseling_logs (
            matching_slot_id, score_technology, score_expertise, score_reliability,
            score_collaboration, score_probability, content, follow_up_required, follow_up_memo, is_public)
        VALUES (p_slot_id, p_score_technology, p_score_expertise, p_score_reliability,
            p_score_collaboration, p_score_probability, p_content, p_follow_up_required, p_follow_up_memo, p_is_public)
        RETURNING id INTO v_log_id;
    ELSE
        -- 이미 COMPLETED 상태에서의 재제출만 '수정'으로 보고 감사 로그를 남긴다.
        -- (임시저장 draft 행을 최종 제출로 확정하는 경우는 수정 이력에서 제외)
        IF v_slot.session_status = 'COMPLETED' THEN
            INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, old_values, new_values, reason)
            VALUES (v_uid, 'EDIT_COUNSELING_LOG', 'counseling_logs', v_existing.id,
                to_jsonb(v_existing),
                jsonb_build_object('content', p_content, 'is_public', p_is_public,
                    'follow_up_required', p_follow_up_required),
                '상담일지 수정');
        END IF;

        UPDATE public.counseling_logs SET
            score_technology = p_score_technology, score_expertise = p_score_expertise,
            score_reliability = p_score_reliability, score_collaboration = p_score_collaboration,
            score_probability = p_score_probability, content = p_content,
            follow_up_required = p_follow_up_required, follow_up_memo = p_follow_up_memo,
            is_public = p_is_public, updated_at = now()
        WHERE id = v_existing.id
        RETURNING id INTO v_log_id;
    END IF;

    -- 최초 확정(임시저장 후 제출 포함): COMPLETED 가 아니면 지금 전환하고 제출 시각을 확정한다.
    IF v_slot.session_status <> 'COMPLETED' THEN
        UPDATE public.matching_slots SET session_status = 'COMPLETED' WHERE id = p_slot_id;
        UPDATE public.counseling_logs SET submitted_at = now() WHERE id = v_log_id;
    END IF;

    RETURN v_log_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_counseling_log(UUID, INT, INT, INT, INT, INT, TEXT, BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_counseling_log(UUID, INT, INT, INT, INT, INT, TEXT, BOOLEAN, TEXT, BOOLEAN) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2-1. 상담일지 임시저장 (전문가 본인) — 점수/코멘트 부분 입력 허용, 세션 미완료
--      점수는 NULL 허용(부분 입력), COMPLETED 로 전환하지 않는다. 최종 확정은
--      submit_counseling_log 가 담당한다.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_counseling_draft(
    p_slot_id UUID,
    p_score_technology INT DEFAULT NULL,
    p_score_expertise INT DEFAULT NULL,
    p_score_reliability INT DEFAULT NULL,
    p_score_collaboration INT DEFAULT NULL,
    p_score_probability INT DEFAULT NULL,
    p_content TEXT DEFAULT NULL,
    p_follow_up_required BOOLEAN DEFAULT FALSE,
    p_follow_up_memo TEXT DEFAULT NULL,
    p_is_public BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_slot public.matching_slots%ROWTYPE;
    v_event_status TEXT;
    v_log_id UUID;
BEGIN
    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id FOR UPDATE;
    IF v_slot.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;
    IF v_slot.expert_id <> v_uid THEN RAISE EXCEPTION '본인 세션의 일지만 작성할 수 있습니다.'; END IF;

    -- 종결된 세션(완료/노쇼/취소)은 임시저장 불가. 대기/진행 중만 허용.
    IF v_slot.session_status NOT IN ('WAITING', 'IN_PROGRESS') THEN
        RAISE EXCEPTION '대기/진행 중인 세션만 임시저장할 수 있습니다. (현재: %)', v_slot.session_status;
    END IF;

    SELECT status INTO v_event_status FROM public.events WHERE id = v_slot.event_id;
    IF v_event_status = 'FINISHED' THEN
        RAISE EXCEPTION '종료된 행사에는 상담일지를 저장할 수 없습니다.';
    END IF;

    INSERT INTO public.counseling_logs (
        matching_slot_id, score_technology, score_expertise, score_reliability,
        score_collaboration, score_probability, content, follow_up_required, follow_up_memo, is_public)
    VALUES (p_slot_id, p_score_technology, p_score_expertise, p_score_reliability,
        p_score_collaboration, p_score_probability, p_content, p_follow_up_required, p_follow_up_memo, p_is_public)
    ON CONFLICT (matching_slot_id) DO UPDATE SET
        score_technology = EXCLUDED.score_technology, score_expertise = EXCLUDED.score_expertise,
        score_reliability = EXCLUDED.score_reliability, score_collaboration = EXCLUDED.score_collaboration,
        score_probability = EXCLUDED.score_probability, content = EXCLUDED.content,
        follow_up_required = EXCLUDED.follow_up_required, follow_up_memo = EXCLUDED.follow_up_memo,
        is_public = EXCLUDED.is_public, updated_at = now()
    RETURNING id INTO v_log_id;

    -- session_status 는 변경하지 않는다(임시저장이므로 COMPLETED 전환 없음).
    RETURN v_log_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_counseling_draft(UUID, INT, INT, INT, INT, INT, TEXT, BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_counseling_draft(UUID, INT, INT, INT, INT, INT, TEXT, BOOLEAN, TEXT, BOOLEAN) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. 노쇼 처리 (관리자, WAITING|IN_PROGRESS → NO_SHOW)
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

    RETURN p_slot_id;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_no_show(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_no_show(UUID, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. 세션 취소 (관리자, WAITING → CANCELLED)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_session(p_slot_id UUID, p_reason TEXT)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_slot public.matching_slots%ROWTYPE;
BEGIN
    IF public.current_app_role() <> 'ADMIN' THEN RAISE EXCEPTION '세션 취소는 관리자만 가능합니다.'; END IF;
    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id FOR UPDATE;
    IF v_slot.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;
    IF v_slot.session_status <> 'WAITING' THEN
        RAISE EXCEPTION '대기(WAITING) 상태에서만 세션을 취소할 수 있습니다. (현재: %)', v_slot.session_status;
    END IF;

    UPDATE public.matching_slots SET session_status = 'CANCELLED' WHERE id = p_slot_id;

    INSERT INTO public.booking_history (matching_slot_id, action_type, actor_id, startup_id, expert_id, previous_slot_info, reason)
    VALUES (p_slot_id, 'CANCELLED', v_uid, v_slot.startup_id, v_slot.expert_id, public._slot_snapshot(v_slot), p_reason);
    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, old_values, reason)
    VALUES (v_uid, 'CANCEL_SESSION', 'matching_slots', p_slot_id, public._slot_snapshot(v_slot), p_reason);

    RETURN p_slot_id;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_session(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_session(UUID, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. 출석 체크 (전문가 본인 / 스타트업은 관리자·스태프)
--    QR 토큰 검증은 Edge Function 에서 수행하고, 본 RPC 는 권한·기록을 담당.
-- -----------------------------------------------------------------------------
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
        -- 전문가는 본인 출석만 처리
        IF NOT (v_uid = p_user_id AND v_slot.expert_id = p_user_id) THEN
            RAISE EXCEPTION '전문가는 본인 출석만 처리할 수 있습니다.';
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
