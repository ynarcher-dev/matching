-- =============================================================================
-- 0075_reopen_counseling_log.sql
--   상담일지 제출 취소 — 전문가가 최종 제출(COMPLETED)한 세션을 다시 진행 중
--   (IN_PROGRESS)으로 되돌린다. 작성 내용(counseling_logs/answers)은 보존하고
--   session_status 만 전환하며, submitted_at 을 비워 "미제출" 상태로 되돌린다.
--   재편집 후 submit_counseling_log_v2(0033) 로 다시 제출할 수 있다.
-- 출처: 전문가 상담 워크스페이스 — "제출 취소" 액션.
-- -----------------------------------------------------------------------------
-- 가드: 본인(EXPERT) 세션 + 현재 COMPLETED + 행사 미종료(FINISHED 아님).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reopen_counseling_log_v2(p_slot_id UUID)
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
    IF v_slot.expert_id <> v_uid THEN RAISE EXCEPTION '본인 세션의 일지만 취소할 수 있습니다.'; END IF;

    IF v_slot.session_status <> 'COMPLETED' THEN
        RAISE EXCEPTION '제출 완료된 세션만 제출을 취소할 수 있습니다. (현재: %)', v_slot.session_status;
    END IF;

    SELECT status INTO v_event_status FROM public.events WHERE id = v_slot.event_id;
    IF v_event_status = 'FINISHED' THEN
        RAISE EXCEPTION '종료된 행사의 상담일지는 취소할 수 없습니다.';
    END IF;

    -- 세션을 진행 중으로 되돌린다. 작성 내용은 보존, 제출 시각만 비운다.
    UPDATE public.matching_slots SET session_status = 'IN_PROGRESS' WHERE id = p_slot_id;
    UPDATE public.counseling_logs
       SET submitted_at = NULL, updated_at = now()
     WHERE matching_slot_id = p_slot_id
     RETURNING id INTO v_log_id;

    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, reason)
    VALUES (v_uid, 'REOPEN_COUNSELING_LOG', 'matching_slots', p_slot_id, '상담일지 제출 취소(재편집)');

    RETURN v_log_id;
END $$;
REVOKE ALL ON FUNCTION public.reopen_counseling_log_v2(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reopen_counseling_log_v2(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.reopen_counseling_log_v2(UUID) TO authenticated;
