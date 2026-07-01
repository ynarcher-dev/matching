-- =============================================================================
-- 0077_emergency_login_rate_limit.sql — 긴급 로그인 토큰 소비에 IP 기반 rate limit
-- 근거: docs/security_remediation_plan.md A-5 (보완-07, Low-Medium)
-- =============================================================================
-- 2026-07-01 보안 조치:
--   emergency-login Edge Function 은 임의의 평문 토큰을 받아 consume RPC 로 소비를
--   시도한다. rate limit 이 없으면 가짜 토큰을 대량으로 던져 (a) DB 커넥션/연산 고갈,
--   (b) 유효 토큰 무차별 대입 시도를 할 수 있다. 참가자 이름+전화 로그인(0035/0046)이
--   이미 쓰는 `participant_login_attempts`(IP 해시 실패 집계) 패턴을 그대로 재사용해
--   동일 IP 10분 20회 실패 초과 시 THROTTLED 를 돌려준다.
--
-- 설계 메모:
--   * 실패 집계 테이블을 참가자 로그인과 공유한다 — 둘 다 "참가자 인증 시도"이고
--     rate limit 단위가 계정이 아니라 IP 이므로, 같은 IP 의 무차별 대입을 두 경로에
--     걸쳐 합산 차단하는 편이 방어적으로 더 강하다. 정상 현장 운영(유효 토큰 소비)은
--     succeeded=TRUE 로 기록되어 실패 카운트에 잡히지 않는다.
--   * ip_hash 는 OTP_IP_SALT 설정 시에만 채워진다(미설정 시 best-effort 로 rate limit
--     생략). Edge 의 hashIp() 가 participant-login 과 동일 로직으로 산출한다.
--   * 시그니처가 (TEXT) → (TEXT, TEXT) 로 바뀌므로, 기존 1-인자 함수를 먼저 DROP 해
--     오버로드 모호성(function is not unique)을 방지한다.
-- =============================================================================

-- 기존 1-인자 버전 제거(2-인자 신설과 오버로드 충돌 방지).
DROP FUNCTION IF EXISTS public.consume_emergency_login_token(TEXT);

CREATE OR REPLACE FUNCTION public.consume_emergency_login_token(
    p_token TEXT,
    p_ip_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_window_seconds CONSTANT INT := 600;  -- rate limit 관찰 창(10분)
    v_max_failures   CONSTANT INT := 20;   -- 창 내 허용 실패 시도 수(공유 IP/NAT 고려)
    v_token TEXT := btrim(coalesce(p_token, ''));
    v_hash TEXT;
    v_row public.emergency_login_tokens%ROWTYPE;
    v_user public.users%ROWTYPE;
    v_used UUID;
    v_recent_failures INT := 0;
BEGIN
    -- rate limit: ip_hash 가 있을 때만 적용(OTP_IP_SALT 미설정 시 생략).
    -- participant_login_attempts 를 참가자 로그인과 공유해 동일 IP 실패 시도를 합산한다.
    IF p_ip_hash IS NOT NULL THEN
        SELECT count(*) INTO v_recent_failures
        FROM public.participant_login_attempts
        WHERE ip_hash = p_ip_hash
          AND succeeded = FALSE
          AND created_at > now() - make_interval(secs => v_window_seconds);

        IF v_recent_failures >= v_max_failures THEN
            RETURN jsonb_build_object('status', 'THROTTLED', 'retry_after', v_window_seconds);
        END IF;
    END IF;

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
        -- 해시 불일치/만료/사용·회수 — 무차별 대입 신호로 실패 집계.
        INSERT INTO public.participant_login_attempts (ip_hash, succeeded)
        VALUES (p_ip_hash, FALSE);
        RETURN jsonb_build_object('status', 'INVALID');
    END IF;

    -- 대상 사용자가 활성 참가자인지 확인.
    SELECT * INTO v_user
    FROM public.users
    WHERE id = v_row.user_id AND deleted_at IS NULL AND role IN ('EXPERT', 'STARTUP');
    IF v_user.id IS NULL THEN
        INSERT INTO public.participant_login_attempts (ip_hash, succeeded)
        VALUES (p_ip_hash, FALSE);
        RETURN jsonb_build_object('status', 'INVALID');
    END IF;

    -- 원자적 1회 사용 처리(동시 재사용 차단).
    UPDATE public.emergency_login_tokens
    SET used_at = now()
    WHERE id = v_row.id AND used_at IS NULL
    RETURNING id INTO v_used;
    IF v_used IS NULL THEN
        INSERT INTO public.participant_login_attempts (ip_hash, succeeded)
        VALUES (p_ip_hash, FALSE);
        RETURN jsonb_build_object('status', 'INVALID');
    END IF;

    -- 긴급 링크 로그인도 최근 로그인 시각에 반영.
    UPDATE public.users SET last_login_at = now() WHERE id = v_user.id;

    -- 성공 시도 기록(실패 카운트에는 잡히지 않음 → 정상 현장 운영 방해 없음).
    INSERT INTO public.participant_login_attempts (ip_hash, succeeded)
    VALUES (p_ip_hash, TRUE);

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

REVOKE ALL ON FUNCTION public.consume_emergency_login_token(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_emergency_login_token(TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_emergency_login_token(TEXT, TEXT) TO service_role;
