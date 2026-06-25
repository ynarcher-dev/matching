-- =============================================================================
-- 0012_admin_user_auth.sql — 관리자 참가자 인증 관리 (Phase 4 슬라이스 2)
-- 출처: docs/page_admin_user_management.md §2.3, docs/security_transactions.md 1장,
--       docs/db_schema.md §2.17(emergency_login_tokens)
-- =============================================================================
-- 2026-06-25 OTP 전환 후속. 0009 에서 테이블(emergency_login_tokens)·골격만 두었던
-- "세션 무효화 / 현장용 1회용 로그인 링크"의 발급·소비·조회 경로를 완성한다.
--   1) admin_invalidate_user_sessions  — session_version 증가(기존 세션 전면 무효화)
--   2) issue_emergency_login_token      — 1회용 로그인 토큰 발급(평문 1회 반환)
--   3) consume_emergency_login_token    — Edge 전용 토큰 소비 → JWT 발급 재료 반환
--   4) admin_participant_auth_overview  — 참가자별 최근 OTP 발송 상태/긴급토큰 활성 여부
--
-- 보안 메모(0002/0009/0010 교훈 재적용):
--   * pgcrypto(gen_random_bytes/digest)는 Supabase 에서 extensions 스키마에 있으므로
--     SET search_path = public, extensions 로 둔다.
--   * 관리자 호출 RPC 는 authenticated 에 GRANT 하되 함수 내부에서 ADMIN 을 검사한다.
--   * consume_* 는 Edge Function(service_role)만 호출하므로 anon/authenticated EXECUTE 를
--     명시 회수하고 service_role 에는 명시 GRANT 한다(클라우드 revoke-by-default 대응).
--   * 1회용 토큰은 고엔트로피(256bit) 난수라 결정적 SHA-256 해시로 저장/조회한다
--     (OTP 처럼 bf-crypt 가 아니라 digest — 단일 조회로 검증 가능).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 세션 무효화 (관리자) — session_version 증가 + 활성 OTP/긴급토큰 정리 + 감사
-- -----------------------------------------------------------------------------
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
        RAISE EXCEPTION '세션 무효화는 전문가/스타트업 참가자에게만 적용합니다.';
    END IF;

    -- 기존 세션(커스텀 JWT) 전면 무효화: session_version 불일치로 RLS 가 거부한다.
    UPDATE public.users
    SET session_version = session_version + 1
    WHERE id = p_user_id;

    -- 진행 중인 인증 자료도 함께 정리(미사용 OTP 챌린지 무효화 + 활성 긴급토큰 회수).
    UPDATE public.auth_otp_challenges
    SET invalidated_at = now()
    WHERE user_id = p_user_id AND used_at IS NULL AND invalidated_at IS NULL;

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

-- -----------------------------------------------------------------------------
-- 2. 긴급 1회용 로그인 토큰 발급 (관리자) — 평문 토큰을 호출부에 1회만 반환
--    발송 장애·현장 예외 시 본인 확인 후 발급. 발급자·대상·만료·사유를 감사에 남긴다.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_emergency_login_token(
    p_user_id UUID,
    p_reason TEXT,
    p_ttl_minutes INT DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_target public.users%ROWTYPE;
    v_ttl INT := COALESCE(p_ttl_minutes, 30);
    v_token TEXT;
    v_expires TIMESTAMPTZ;
BEGIN
    IF public.current_app_role() <> 'ADMIN' THEN
        RAISE EXCEPTION '권한이 없습니다: 로그인 링크 발급은 관리자만 가능합니다.';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
        RAISE EXCEPTION '로그인 링크 발급 사유는 필수입니다.';
    END IF;

    SELECT * INTO v_target FROM public.users WHERE id = p_user_id AND deleted_at IS NULL;
    IF v_target.id IS NULL THEN
        RAISE EXCEPTION '대상 사용자를 찾을 수 없습니다.';
    END IF;
    IF v_target.role NOT IN ('EXPERT', 'STARTUP') THEN
        RAISE EXCEPTION '로그인 링크는 전문가/스타트업 참가자에게만 발급합니다.';
    END IF;

    -- TTL 5분~4시간으로 제한(기본 30분).
    v_ttl := GREATEST(5, LEAST(v_ttl, 240));
    v_expires := now() + make_interval(mins => v_ttl);

    -- 같은 사용자의 기존 미사용 토큰은 회수(동시 유효 토큰 1개 원칙).
    UPDATE public.emergency_login_tokens
    SET revoked_at = now()
    WHERE user_id = p_user_id AND used_at IS NULL AND revoked_at IS NULL;

    -- 256bit 난수 토큰(평문은 반환만). 저장은 결정적 SHA-256 해시.
    v_token := encode(gen_random_bytes(32), 'hex');

    INSERT INTO public.emergency_login_tokens (user_id, token_hash, issued_by, reason, expires_at)
    VALUES (p_user_id, encode(digest(v_token, 'sha256'), 'hex'), v_uid, btrim(p_reason), v_expires);

    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, new_values, reason)
    VALUES (v_uid, 'ISSUE_EMERGENCY_LOGIN_TOKEN', 'users', p_user_id,
        jsonb_build_object('expires_at', v_expires, 'ttl_minutes', v_ttl), btrim(p_reason));

    RETURN jsonb_build_object('token', v_token, 'expires_at', v_expires);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_emergency_login_token(UUID, TEXT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.issue_emergency_login_token(UUID, TEXT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_emergency_login_token(UUID, TEXT, INT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. 긴급 토큰 소비 (Edge Function 전용) — 검증 OK 면 JWT 발급 재료 반환
--    반환 jsonb:
--      { status:'OK', user_id, role, session_version }  (원자적 1회 사용 처리)
--      { status:'INVALID' }                              (불일치/만료/사용·회수됨)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_emergency_login_token(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_token TEXT := btrim(coalesce(p_token, ''));
    v_hash TEXT;
    v_row public.emergency_login_tokens%ROWTYPE;
    v_user public.users%ROWTYPE;
    v_used UUID;
BEGIN
    IF v_token = '' THEN
        RETURN jsonb_build_object('status', 'INVALID');
    END IF;

    v_hash := encode(digest(v_token, 'sha256'), 'hex');

    SELECT * INTO v_row
    FROM public.emergency_login_tokens
    WHERE token_hash = v_hash
      AND used_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > now()
    FOR UPDATE;

    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('status', 'INVALID');
    END IF;

    -- 대상 사용자가 활성 참가자인지 확인.
    SELECT * INTO v_user
    FROM public.users
    WHERE id = v_row.user_id AND deleted_at IS NULL AND role IN ('EXPERT', 'STARTUP');
    IF v_user.id IS NULL THEN
        RETURN jsonb_build_object('status', 'INVALID');
    END IF;

    -- 원자적 1회 사용 처리(동시 재사용 차단).
    UPDATE public.emergency_login_tokens
    SET used_at = now()
    WHERE id = v_row.id AND used_at IS NULL
    RETURNING id INTO v_used;
    IF v_used IS NULL THEN
        RETURN jsonb_build_object('status', 'INVALID');
    END IF;

    -- 사용 사실을 감사에 남긴다(actor=대상 본인, 발급/사용 시각은 토큰 행에도 보존).
    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, new_values, reason)
    VALUES (v_user.id, 'CONSUME_EMERGENCY_LOGIN_TOKEN', 'users', v_user.id,
        jsonb_build_object('token_id', v_row.id), v_row.reason);

    RETURN jsonb_build_object(
        'status', 'OK',
        'user_id', v_user.id,
        'role', v_user.role,
        'session_version', v_user.session_version
    );
END;
$$;
REVOKE ALL ON FUNCTION public.consume_emergency_login_token(TEXT) FROM PUBLIC;
-- Edge Function(service_role)만 호출한다. 클라이언트 직접 호출 차단.
REVOKE EXECUTE ON FUNCTION public.consume_emergency_login_token(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_emergency_login_token(TEXT) TO service_role;

-- -----------------------------------------------------------------------------
-- 4. 참가자 인증 개요 (관리자) — 최근 OTP 발송 상태 + 활성 긴급토큰 여부
--    OTP 챌린지 테이블은 클라이언트 직접 조회가 차단(0009)되어 있으므로,
--    민감값(otp_hash 등)을 제외한 요약만 ADMIN 에게 SECURITY DEFINER 로 노출한다.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_participant_auth_overview()
RETURNS TABLE (
    user_id UUID,
    otp_channel TEXT,
    otp_status TEXT,
    otp_requested_at TIMESTAMPTZ,
    has_active_emergency BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF public.current_app_role() <> 'ADMIN' THEN
        RAISE EXCEPTION '권한이 없습니다: 관리자만 조회할 수 있습니다.';
    END IF;

    RETURN QUERY
    WITH last_otp AS (
        SELECT DISTINCT ON (c.user_id)
            c.user_id, c.channel, c.created_at, c.used_at, c.invalidated_at, c.expires_at
        FROM public.auth_otp_challenges c
        WHERE c.purpose = 'PARTICIPANT_LOGIN'
        ORDER BY c.user_id, c.created_at DESC
    ),
    active_emerg AS (
        SELECT DISTINCT t.user_id
        FROM public.emergency_login_tokens t
        WHERE t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at > now()
    )
    SELECT
        u.id,
        lo.channel,
        CASE
            WHEN lo.user_id IS NULL THEN 'NONE'
            WHEN lo.used_at IS NOT NULL THEN 'USED'
            WHEN lo.invalidated_at IS NOT NULL THEN 'INVALIDATED'
            WHEN lo.expires_at <= now() THEN 'EXPIRED'
            ELSE 'SENT'
        END,
        lo.created_at,
        (ae.user_id IS NOT NULL)
    FROM public.users u
    LEFT JOIN last_otp lo ON lo.user_id = u.id
    LEFT JOIN active_emerg ae ON ae.user_id = u.id
    WHERE u.deleted_at IS NULL AND u.role IN ('EXPERT', 'STARTUP');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_participant_auth_overview() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_participant_auth_overview() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_participant_auth_overview() TO authenticated;
