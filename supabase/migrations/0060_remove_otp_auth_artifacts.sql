-- =============================================================================
-- 0060_remove_otp_auth_artifacts.sql
-- Free login mode cleanup: remove legacy participant OTP diagnostics/storage.
-- =============================================================================

-- admin_invalidate_user_sessions no longer touches auth_otp_challenges because
-- participant OTP auth has been retired. Emergency one-time links remain.
CREATE OR REPLACE FUNCTION public.admin_invalidate_user_sessions(p_user_id UUID, p_reason TEXT)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_target public.users%ROWTYPE;
BEGIN
    IF public.current_app_role() <> 'ADMIN' THEN
        RAISE EXCEPTION '권한이 없습니다: 세션 무효화는 관리자만 가능합니다.';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
        RAISE EXCEPTION '세션 무효화 사유는 필수입니다.';
    END IF;

    SELECT * INTO v_target FROM public.users WHERE id = p_user_id AND deleted_at IS NULL FOR UPDATE;
    IF v_target.id IS NULL THEN
        RAISE EXCEPTION '대상 사용자를 찾을 수 없습니다.';
    END IF;
    IF v_target.role NOT IN ('EXPERT', 'STARTUP') THEN
        RAISE EXCEPTION '세션 무효화는 전문가/스타트업 참가자에게만 적용됩니다.';
    END IF;

    UPDATE public.users
    SET session_version = session_version + 1
    WHERE id = p_user_id;

    UPDATE public.emergency_login_tokens
    SET revoked_at = now()
    WHERE user_id = p_user_id AND used_at IS NULL AND revoked_at IS NULL;

    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, old_values, new_values, reason)
    VALUES (v_uid, 'INVALIDATE_USER_SESSIONS', 'users', p_user_id,
        jsonb_build_object('session_version', v_target.session_version),
        jsonb_build_object('session_version', v_target.session_version + 1), p_reason);

    RETURN p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_invalidate_user_sessions(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_invalidate_user_sessions(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_invalidate_user_sessions(UUID, TEXT) TO authenticated;

DROP FUNCTION IF EXISTS public.admin_participant_auth_overview();
DROP FUNCTION IF EXISTS public.request_participant_otp(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.verify_participant_otp(TEXT, TEXT);
DROP TABLE IF EXISTS public.auth_otp_challenges;
