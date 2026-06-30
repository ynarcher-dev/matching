-- =============================================================================
-- 0046_login_and_upload_tracking.sql — 참가자 DB 운영 컬럼 재정리 (Phase 8-B)
-- 출처: docs/functional_followup_plan.md T2, docs/development_status.md 8-B
-- =============================================================================
-- 2026-06-28 기획 확정(사용자 합의):
--   무료 운영 모드(이름+휴대전화 로그인, 0035)에서는 `최근 OTP` 컬럼이 운영 의미를
--   잃었다. 이를 진단용으로 격리하고, 참가자 DB 의 핵심 운영 지표를 다음으로 재정렬한다.
--     1) 최근 로그인 시각(last_login_at) — 무료 운영 로그인/긴급 링크 소비 시 갱신.
--     2) 스타트업 IR/소개서 마지막 업로드 주체/시각(proposal_uploaded_by/at).
--
--   기존 OTP 인프라(0009~0012 admin_participant_auth_overview 등)는 보존하며,
--   화면에서 진단 토글로만 노출한다(여기서는 DB 컬럼만 추가).
--
-- 보안/정합 메모:
--   * last_login_at 갱신은 인증 성공 경로(SECURITY DEFINER RPC) 안에서만 수행한다.
--   * 업로드 주체는 BEFORE 트리거에서 current_app_user_id() 로 자동 기록한다 —
--     관리자 대행 업로드(현재)와 스타트업 자가 업로드(8-H 예정) 양쪽을 한 경로로 잡는다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 컬럼 추가 — 최근 로그인 + IR 업로드 출처
-- -----------------------------------------------------------------------------
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS proposal_uploaded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS proposal_uploaded_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- 2. 트리거 — proposal_file_url 변경 시 업로드 주체/시각 자동 기록
--    INSERT(파일 동반 생성) / UPDATE(교체·해제) 모두 처리한다.
--    NULL 로 해제되면 출처도 함께 비운다.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.track_proposal_upload()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.proposal_file_url IS NOT NULL THEN
            NEW.proposal_uploaded_at := now();
            NEW.proposal_uploaded_by := public.current_app_user_id();
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE: 파일 경로가 실제로 바뀐 경우에만 출처를 갱신한다.
    IF NEW.proposal_file_url IS DISTINCT FROM OLD.proposal_file_url THEN
        IF NEW.proposal_file_url IS NULL THEN
            NEW.proposal_uploaded_at := NULL;
            NEW.proposal_uploaded_by := NULL;
        ELSE
            NEW.proposal_uploaded_at := now();
            NEW.proposal_uploaded_by := public.current_app_user_id();
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_track_proposal_upload ON public.users;
CREATE TRIGGER trg_track_proposal_upload
    BEFORE INSERT OR UPDATE OF proposal_file_url ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.track_proposal_upload();

-- 기존 데이터 backfill: 이미 소개서가 있는데 업로드 시각이 비어 있으면 등록일로 근사한다
-- (주체는 알 수 없어 NULL 유지 — '확인 불가'로 표시).
UPDATE public.users
SET proposal_uploaded_at = created_at
WHERE proposal_file_url IS NOT NULL AND proposal_uploaded_at IS NULL;

-- -----------------------------------------------------------------------------
-- 3. 로그인 RPC 갱신 — 성공 시 last_login_at 기록 (0035 재정의)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.login_participant_by_name_phone(
    p_name TEXT,
    p_phone TEXT,
    p_ip_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_window_seconds CONSTANT INT := 600;  -- rate limit 관찰 창(10분)
    v_max_failures   CONSTANT INT := 20;   -- 창 내 허용 실패 시도 수(공유 IP/NAT 고려)
    v_user public.users%ROWTYPE;
    v_user_id UUID;
    v_recent_failures INT := 0;
BEGIN
    -- 4-1) rate limit: ip_hash 가 있을 때만 적용(OTP_IP_SALT 미설정 시 best-effort 생략).
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

    -- 4-2) 매칭
    v_user_id := public.match_participant_by_name_phone(p_name, p_phone);

    IF v_user_id IS NULL THEN
        INSERT INTO public.participant_login_attempts (ip_hash, succeeded)
        VALUES (p_ip_hash, FALSE);
        RETURN jsonb_build_object('status', 'INVALID');
    END IF;

    -- 4-3) 성공 처리(+ 최근 로그인 시각 기록)
    INSERT INTO public.participant_login_attempts (ip_hash, succeeded)
    VALUES (p_ip_hash, TRUE);

    UPDATE public.users SET last_login_at = now() WHERE id = v_user_id;

    SELECT * INTO v_user FROM public.users WHERE id = v_user_id;
    RETURN jsonb_build_object(
        'status', 'OK',
        'user_id', v_user.id,
        'role', v_user.role,
        'session_version', v_user.session_version
    );
END;
$$;

REVOKE ALL ON FUNCTION public.login_participant_by_name_phone(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.login_participant_by_name_phone(TEXT, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_participant_by_name_phone(TEXT, TEXT, TEXT) TO service_role;

-- -----------------------------------------------------------------------------
-- 4. 긴급 토큰 소비 RPC 갱신 — 성공 시 last_login_at 기록 (0012 재정의)
--    1회용 현장 로그인 링크로 들어와도 '최근 로그인'에 반영되도록 한다.
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

    -- 긴급 링크 로그인도 최근 로그인 시각에 반영.
    UPDATE public.users SET last_login_at = now() WHERE id = v_user.id;

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
REVOKE EXECUTE ON FUNCTION public.consume_emergency_login_token(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_emergency_login_token(TEXT) TO service_role;
