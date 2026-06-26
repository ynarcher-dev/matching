-- =============================================================================
-- 0035_participant_name_phone_login.sql — 무료 운영 전환: 참가자 로그인을
--   "등록 이메일/휴대전화 + 6자리 OTP" 에서 "이름 + 휴대전화번호 정확일치" 로 전환
-- 출처: docs/free_login_transition.md, docs/page_auth_layout.md §1, dev_conventions.md 5장
-- =============================================================================
-- 2026-06-26 기획 확정(사용자 합의):
--   참가자(EXPERT/STARTUP) 인증을 외부 발송(SMS/이메일 OTP)에 의존하지 않도록
--   "이름 + 휴대전화번호" 정확일치 검증 방식으로 전환한다.
--   - 입력값: 이름 + 전체 휴대전화번호 (행사코드 미사용).
--   - 이름 매칭: 공백 정규화 + 대소문자 무시.  전화: 숫자만 정규화.
--   - 정확히 1명만 일치할 때만 로그인 성공. 0명/2명+ 는 모호 → 실패.
--   - 실패 응답은 계정 존재 여부를 노출하지 않는다(Edge 가 generic 처리).
--   - 로그인 시도 rate limit 을 IP 해시 기준으로 적용(brute-force 완화).
--
-- 보존 정책(사용자 합의):
--   기존 OTP 인프라(auth_otp_challenges / request_participant_otp /
--   verify_participant_otp / participant-otp-* Edge)는 삭제하지 않고 비활성으로
--   보존한다. 유료 알림모드 도입 시 재활성화할 수 있다. 여기서는 신규 로그인
--   경로만 추가하며 기존 객체는 건드리지 않는다.
--
-- 보안 메모(0009/0010 교훈 재적용):
--   * SECURITY DEFINER RPC 는 Edge Function(service_role)만 호출하도록
--     anon, authenticated 의 EXECUTE 를 명시 회수하고 service_role 에만 부여한다
--     (이 프로젝트는 revoke-by-default 라 service_role 암묵 EXECUTE 도 사라짐 → 명시 GRANT).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 헬퍼 — 이름 정규화 (공백 전부 제거 + 소문자)
--    "홍 길동" / "홍길동" / "Hong Gildong" / "honggildong" 를 동일하게 취급한다.
--    normalize_phone(0009) 은 그대로 재사용한다(숫자만).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_name(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT lower(regexp_replace(coalesce(p_name, ''), '\s', '', 'g'));
$$;

-- -----------------------------------------------------------------------------
-- 2. 테이블 — participant_login_attempts (로그인 시도 rate limit 용)
--    IP 해시(OTP_IP_SALT 설정 시에만 채워짐) 기준으로 최근 실패 시도를 센다.
--    클라이언트 직접 접근 전면 차단(RLS deny-all). service_role(Edge)만 접근.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.participant_login_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip_hash TEXT,
    succeeded BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS participant_login_attempts_ip_idx
    ON public.participant_login_attempts (ip_hash, created_at DESC)
    WHERE ip_hash IS NOT NULL;

ALTER TABLE public.participant_login_attempts ENABLE ROW LEVEL SECURITY;
-- 정책 미생성 = anon/authenticated 전면 deny. service_role 은 RLS 우회.
REVOKE ALL ON public.participant_login_attempts FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. 이름 + 휴대전화번호 매칭 (활성 참가자, 정확히 1명일 때만 확정)
--    모호하게 여러 명과 일치하면 NULL(누구로도 로그인 금지).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_participant_by_name_phone(
    p_name TEXT,
    p_phone TEXT
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_name TEXT := public.normalize_name(p_name);
    v_phone TEXT := public.normalize_phone(p_phone);
    v_ids UUID[];
BEGIN
    -- 빈 이름이나 9자리 미만 전화는 매칭 시도하지 않는다(모호/오입력 방어).
    IF v_name = '' OR length(v_phone) < 9 THEN
        RETURN NULL;
    END IF;

    SELECT array_agg(u.id) INTO v_ids
    FROM public.users u
    WHERE u.deleted_at IS NULL
      AND u.role IN ('EXPERT', 'STARTUP')
      AND public.normalize_name(u.name) = v_name
      AND public.normalize_phone(u.phone_number) = v_phone;

    -- 정확히 1명일 때만 확정(0명=미등록, 2명+=모호 → NULL).
    IF array_length(v_ids, 1) = 1 THEN
        RETURN v_ids[1];
    END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.match_participant_by_name_phone(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.match_participant_by_name_phone(TEXT, TEXT) FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. 로그인 RPC (Edge Function 이 호출 → OK 면 JWT 발급)
--    반환 jsonb:
--      { status:'OK', user_id, role, session_version }  (정확히 1명 일치)
--      { status:'THROTTLED', retry_after }              (IP 기준 시도 과다)
--      { status:'INVALID' }                             (미등록/모호/오입력)
--    Edge 는 INVALID 를 401, THROTTLED 를 429 로 매핑하고 본문은 generic 으로 둔다.
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

    -- 4-3) 성공 처리
    INSERT INTO public.participant_login_attempts (ip_hash, succeeded)
    VALUES (p_ip_hash, TRUE);

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
