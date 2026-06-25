-- =============================================================================
-- 0009_otp_auth.sql — 참가자 OTP 로그인 전환 (Access Code → 등록 연락처 6자리 OTP)
-- 출처: docs/db_schema.md §2.16~2.17/§4.7, docs/security_transactions.md 1장,
--       docs/page_auth_layout.md §1.3~1.4, docs/dev_conventions.md 5장
-- =============================================================================
-- 2026-06-25 기획 변경:
--   참가자(EXPERT/STARTUP) 인증을 사용자별 장기 Access Code 에서
--   "등록 이메일/휴대전화 + 6자리 OTP" 로 전환한다.
--   - OTP 원문은 저장/로깅하지 않고 단방향 해시(crypt bf)만 저장한다.
--   - 기본 5분 만료, 재요청 60초 제한, 챌린지당 검증 실패 최대 5회.
--   - 요청 응답은 계정 존재 여부를 노출하지 않는 generic 형태(Edge 가 보장).
--   - 새 OTP 발급 시 같은 목적의 이전 미사용 OTP 무효화, 검증 성공은 원자적 1회 사용.
--
-- 보안 메모(0002/0008 교훈 재적용):
--   * pgcrypto(crypt/gen_salt)는 Supabase 의 extensions 스키마에 있으므로
--     SET search_path = public, extensions 로 둔다.
--   * SECURITY DEFINER RPC 는 Edge Function(service_role)만 호출하도록
--     anon, authenticated 의 EXECUTE 를 명시 회수한다(REVOKE FROM PUBLIC 만으론 부족).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 테이블 — auth_otp_challenges (db_schema.md §2.16)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auth_otp_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    purpose VARCHAR(50) NOT NULL DEFAULT 'PARTICIPANT_LOGIN',
    channel VARCHAR(20) NOT NULL,
    destination_normalized TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    attempt_count INT NOT NULL DEFAULT 0,
    used_at TIMESTAMP WITH TIME ZONE,
    invalidated_at TIMESTAMP WITH TIME ZONE,
    requested_ip_hash TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_otp_purpose CHECK (purpose IN ('PARTICIPANT_LOGIN')),
    CONSTRAINT chk_otp_channel CHECK (channel IN ('EMAIL', 'SMS', 'ALIMTALK')),
    CONSTRAINT chk_otp_attempt_count CHECK (attempt_count BETWEEN 0 AND 5)
);

CREATE INDEX IF NOT EXISTS auth_otp_active_lookup_idx
    ON public.auth_otp_challenges (user_id, purpose, created_at DESC)
    WHERE used_at IS NULL AND invalidated_at IS NULL;

-- -----------------------------------------------------------------------------
-- 2. 테이블 — emergency_login_tokens (db_schema.md §2.17)
--    현장 발송 장애 시 관리자가 발급하는 1회용 로그인 링크 토큰.
--    발급/소비 RPC·Edge·관리자 화면은 Phase 4(참가자 관리 UI)에서 연결한다.
--    여기서는 스키마·RLS 골격만 둔다.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.emergency_login_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    issued_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS emergency_login_active_idx
    ON public.emergency_login_tokens (user_id, created_at DESC)
    WHERE used_at IS NULL AND revoked_at IS NULL;

-- -----------------------------------------------------------------------------
-- 3. RLS — 두 테이블 모두 클라이언트 직접 접근 전면 차단
--    (OTP 해시·챌린지 정보는 어떤 클라이언트도 조회/변경할 수 없다.
--     service_role 은 RLS 를 우회하므로 Edge Function 만 접근 가능.)
-- -----------------------------------------------------------------------------
ALTER TABLE public.auth_otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_login_tokens ENABLE ROW LEVEL SECURITY;
-- 정책을 만들지 않으면 anon/authenticated 에게 모든 행이 거부된다(기본 deny).
REVOKE ALL ON public.auth_otp_challenges FROM anon, authenticated;
REVOKE ALL ON public.emergency_login_tokens FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. 헬퍼 — 휴대전화 정규화 / 6자리 OTP 생성
-- -----------------------------------------------------------------------------
-- 표시용 하이픈/공백 제거 후 숫자만 남긴다(저장·매칭 기준).
CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
$$;

-- 6자리(앞자리 0 허용) OTP. 평문은 호출부(Edge)에만 1회 반환하고 저장하지 않는다.
CREATE OR REPLACE FUNCTION public.generate_otp()
RETURNS TEXT
LANGUAGE sql
VOLATILE
AS $$
    SELECT lpad((floor(random() * 1000000))::int::text, 6, '0');
$$;

-- -----------------------------------------------------------------------------
-- 5. 식별자 → 활성 참가자 매칭 (이메일 또는 휴대전화)
--    모호하게 여러 활성 참가자와 일치하면 NULL(누구에게도 발송 금지).
--    반환: 매칭된 단일 user_id 또는 NULL.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_participant_by_identifier(p_identifier TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ident TEXT := btrim(coalesce(p_identifier, ''));
    v_email TEXT := lower(v_ident);
    v_phone TEXT := public.normalize_phone(v_ident);
    v_count INT;
    v_user_id UUID;
BEGIN
    IF v_ident = '' THEN
        RETURN NULL;
    END IF;

    -- 이메일 형식이면 이메일로만, 그 외 숫자 위주면 휴대전화로 매칭.
    IF position('@' IN v_ident) > 0 THEN
        SELECT count(*), min(u.id) INTO v_count, v_user_id
        FROM public.users u
        WHERE u.deleted_at IS NULL
          AND u.role IN ('EXPERT', 'STARTUP')
          AND lower(u.email) = v_email;
    ELSIF length(v_phone) >= 9 THEN
        SELECT count(*), min(u.id) INTO v_count, v_user_id
        FROM public.users u
        WHERE u.deleted_at IS NULL
          AND u.role IN ('EXPERT', 'STARTUP')
          AND public.normalize_phone(u.phone_number) = v_phone;
    ELSE
        RETURN NULL;
    END IF;

    -- 정확히 1명일 때만 확정(0명=미등록, 2명+=모호 → NULL).
    IF v_count = 1 THEN
        RETURN v_user_id;
    END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.match_participant_by_identifier(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.match_participant_by_identifier(TEXT) FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. OTP 요청 (Edge Function 이 호출 → 평문 OTP 를 발송용으로 1회 반환)
--    반환 jsonb:
--      { status:'SENT', otp, channel, destination, user_id, retry_after }  (신규 발급)
--      { status:'THROTTLED', retry_after }                                  (60초 내 재요청)
--      { status:'SKIP', retry_after }                                       (미등록/모호 매칭)
--    어떤 경우든 Edge 는 generic 200 을 반환해 계정 존재 여부를 노출하지 않는다.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_participant_otp(
    p_identifier TEXT,
    p_ip_hash TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_resend_interval CONSTANT INT := 60;   -- 재요청 최소 간격(초)
    v_ttl_minutes CONSTANT INT := 5;         -- OTP 만료(분)
    v_user public.users%ROWTYPE;
    v_user_id UUID;
    v_ident TEXT := btrim(coalesce(p_identifier, ''));
    v_channel TEXT;
    v_destination TEXT;
    v_last_created TIMESTAMPTZ;
    v_elapsed INT;
    v_otp TEXT;
BEGIN
    v_user_id := public.match_participant_by_identifier(v_ident);
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('status', 'SKIP', 'retry_after', v_resend_interval);
    END IF;

    SELECT * INTO v_user FROM public.users WHERE id = v_user_id;

    -- 채널 결정: 이메일 입력=EMAIL, 그 외=SMS(휴대전화). 등록값을 발송 대상으로 사용.
    IF position('@' IN v_ident) > 0 THEN
        v_channel := 'EMAIL';
        v_destination := lower(v_user.email);
    ELSE
        v_channel := 'SMS';
        v_destination := public.normalize_phone(v_user.phone_number);
    END IF;

    -- 레이트리밋: 동일 사용자·목적의 가장 최근 챌린지가 60초 이내면 새로 발급하지 않는다.
    SELECT created_at INTO v_last_created
    FROM public.auth_otp_challenges
    WHERE user_id = v_user_id AND purpose = 'PARTICIPANT_LOGIN'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_last_created IS NOT NULL THEN
        v_elapsed := floor(extract(epoch FROM (now() - v_last_created)))::int;
        IF v_elapsed < v_resend_interval THEN
            RETURN jsonb_build_object(
                'status', 'THROTTLED',
                'retry_after', v_resend_interval - v_elapsed
            );
        END IF;
    END IF;

    -- 이전 미사용 OTP 무효화(새 발급 정책).
    UPDATE public.auth_otp_challenges
    SET invalidated_at = now()
    WHERE user_id = v_user_id
      AND purpose = 'PARTICIPANT_LOGIN'
      AND used_at IS NULL
      AND invalidated_at IS NULL;

    v_otp := public.generate_otp();

    INSERT INTO public.auth_otp_challenges (
        user_id, purpose, channel, destination_normalized, otp_hash,
        expires_at, requested_ip_hash
    ) VALUES (
        v_user_id, 'PARTICIPANT_LOGIN', v_channel, v_destination,
        crypt(v_otp, gen_salt('bf')),
        now() + make_interval(mins => v_ttl_minutes),
        p_ip_hash
    );

    -- 평문 OTP 는 반환만(발송용). DB/로그에 남기지 않는다.
    RETURN jsonb_build_object(
        'status', 'SENT',
        'otp', v_otp,
        'channel', v_channel,
        'destination', v_destination,
        'user_id', v_user_id,
        'retry_after', v_resend_interval
    );
END;
$$;

REVOKE ALL ON FUNCTION public.request_participant_otp(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_participant_otp(TEXT, TEXT) FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. OTP 검증 (Edge Function 이 호출 → OK 면 JWT 발급)
--    반환 jsonb:
--      { status:'OK', user_id, role, session_version }   (검증 성공·1회 사용 처리)
--      { status:'INVALID' }                               (불일치/만료/소진/모호)
--    검증 성공과 used_at 기록은 원자적(UPDATE ... WHERE used_at IS NULL)으로 처리한다.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_participant_otp(
    p_identifier TEXT,
    p_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_max_attempts CONSTANT INT := 5;
    v_user public.users%ROWTYPE;
    v_user_id UUID;
    v_code TEXT := btrim(coalesce(p_code, ''));
    v_challenge public.auth_otp_challenges%ROWTYPE;
    v_used UUID;
BEGIN
    IF v_code = '' THEN
        RETURN jsonb_build_object('status', 'INVALID');
    END IF;

    v_user_id := public.match_participant_by_identifier(p_identifier);
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('status', 'INVALID');
    END IF;

    -- 가장 최근의 유효(미사용·미무효·미만료) 챌린지를 잠금 후 검증.
    SELECT * INTO v_challenge
    FROM public.auth_otp_challenges
    WHERE user_id = v_user_id
      AND purpose = 'PARTICIPANT_LOGIN'
      AND used_at IS NULL
      AND invalidated_at IS NULL
      AND expires_at > now()
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_challenge.id IS NULL THEN
        RETURN jsonb_build_object('status', 'INVALID');
    END IF;

    -- 실패 횟수 소진 → 무효화 후 거부(새 OTP 요청 필요).
    IF v_challenge.attempt_count >= v_max_attempts THEN
        UPDATE public.auth_otp_challenges SET invalidated_at = now() WHERE id = v_challenge.id;
        RETURN jsonb_build_object('status', 'INVALID');
    END IF;

    IF v_challenge.otp_hash = crypt(v_code, v_challenge.otp_hash) THEN
        -- 원자적 1회 사용 처리(동시 재사용 차단).
        UPDATE public.auth_otp_challenges
        SET used_at = now()
        WHERE id = v_challenge.id AND used_at IS NULL
        RETURNING id INTO v_used;

        IF v_used IS NULL THEN
            RETURN jsonb_build_object('status', 'INVALID');
        END IF;

        SELECT * INTO v_user FROM public.users WHERE id = v_user_id;
        RETURN jsonb_build_object(
            'status', 'OK',
            'user_id', v_user.id,
            'role', v_user.role,
            'session_version', v_user.session_version
        );
    END IF;

    -- 불일치 → 실패 횟수 증가(소진 시 무효화).
    UPDATE public.auth_otp_challenges
    SET attempt_count = attempt_count + 1,
        invalidated_at = CASE WHEN attempt_count + 1 >= v_max_attempts THEN now() ELSE invalidated_at END
    WHERE id = v_challenge.id;

    RETURN jsonb_build_object('status', 'INVALID');
END;
$$;

REVOKE ALL ON FUNCTION public.verify_participant_otp(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.verify_participant_otp(TEXT, TEXT) FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. 기존 Access Code 경로 비활성화(전환기 Deprecated)
--    컬럼(access_code_hash/_issued_at)은 전환 데이터 정리 전까지 보존하되,
--    발급/검증/재발송 빌딩블록은 클라이언트에서 호출할 수 없도록 잠근다.
--    (participant_login / reissue_access_code_self 는 이미 anon/authenticated 회수됨.
--     issue_access_code 는 0002 에서 authenticated 에 GRANT 되어 있으므로 회수한다.)
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.issue_access_code(UUID) FROM authenticated;
