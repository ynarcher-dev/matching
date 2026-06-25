-- =============================================================================
-- 0002_auth_helpers.sql — 인증/세션 헬퍼 + Access Code 해시/검증
-- 출처: docs/security_transactions.md 1장, docs/dev_conventions.md 5장
-- =============================================================================
-- 두 인증 경로:
--   1) ADMIN/STAFF : Supabase Auth (auth.uid() 유효, users.auth_user_id 매핑)
--   2) EXPERT/STARTUP : Edge Function 커스텀 JWT (claim: participant_id, session_version)
-- 모든 권한 판정은 auth.uid() 직접 사용 대신 아래 헬퍼를 경유한다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 현재 호출자의 public.users.id 해석 (재귀 RLS 회피용 SECURITY DEFINER)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT CASE
        WHEN (auth.jwt() ->> 'participant_id') IS NOT NULL THEN (
            -- 참가자 커스텀 JWT: session_version 일치까지 검증해 재발급 무효화 반영
            SELECT u.id
            FROM public.users u
            WHERE u.id = (auth.jwt() ->> 'participant_id')::uuid
              AND u.deleted_at IS NULL
              AND u.session_version = (auth.jwt() ->> 'session_version')::int
        )
        ELSE (
            -- Supabase Auth (ADMIN/STAFF)
            SELECT u.id
            FROM public.users u
            WHERE u.auth_user_id = auth.uid()
              AND u.deleted_at IS NULL
        )
    END;
$$;

REVOKE ALL ON FUNCTION public.current_app_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. 현재 호출자의 역할 / 최고관리자 여부
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role FROM public.users WHERE id = public.current_app_user_id();
$$;

REVOKE ALL ON FUNCTION public.current_app_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_app_role() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT is_super_admin FROM public.users
         WHERE id = public.current_app_user_id() AND role = 'ADMIN'),
        FALSE
    );
$$;

REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Access Code 해시/검증
-- -----------------------------------------------------------------------------
-- 정규화: 표시 구분자(하이픈/공백) 제거 + 대문자화. 저장 해시는 정규화된 8자리 기준.
CREATE OR REPLACE FUNCTION public.normalize_access_code(p_code TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- 8자리 비혼동 코드 생성(0/O/1/I/L 제외). 평문은 호출부에서 1회만 노출.
CREATE OR REPLACE FUNCTION public.generate_access_code()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
    alphabet CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    result TEXT := '';
    i INT;
BEGIN
    FOR i IN 1..8 LOOP
        result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    END LOOP;
    RETURN result;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. 참가자 로그인 검증 빌딩블록 (Edge Function 이 호출 → JWT 발급)
--    반환 jsonb: { status: 'OK'|'INVALID', user_id, role, session_version }
--    실패 횟수 제한/계정 잠금은 두지 않는다(2026-06-25 명세). 비정상 트래픽 차단은
--    Edge Function 레벨의 레이트리밋/캡차로 대응한다.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.participant_login(p_identifier TEXT, p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
-- pgcrypto(crypt/gen_salt)는 Supabase 에서 extensions 스키마에 설치되므로 search_path 에 포함한다.
SET search_path = public, extensions
AS $$
DECLARE
    v_norm_code TEXT := public.normalize_access_code(p_code);
    v_ident TEXT := btrim(coalesce(p_identifier, ''));
    v_user public.users%ROWTYPE;
BEGIN
    -- 식별자(이메일/기업명/이름)로 후보를 찾아 코드 일치 검사
    SELECT u.* INTO v_user
    FROM public.users u
    WHERE u.role IN ('EXPERT', 'STARTUP')
      AND u.deleted_at IS NULL
      AND u.access_code_hash IS NOT NULL
      AND (u.email = v_ident OR u.company_name = v_ident OR u.name = v_ident)
      AND u.access_code_hash = crypt(v_norm_code, u.access_code_hash)
    LIMIT 1;

    IF v_user.id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'status', 'OK',
            'user_id', v_user.id,
            'role', v_user.role,
            'session_version', v_user.session_version
        );
    END IF;

    RETURN jsonb_build_object('status', 'INVALID');
END;
$$;

REVOKE ALL ON FUNCTION public.participant_login(TEXT, TEXT) FROM PUBLIC;
-- Edge Function(service_role)만 호출한다. anon/authenticated 직접 호출은 허용하지 않는다.
-- ※ Supabase 는 public 함수에 anon/authenticated EXECUTE 를 기본권한으로 부여하므로
--   FROM PUBLIC 만으로는 부족하다. 두 역할의 EXECUTE 를 명시적으로 회수한다.
--   (service_role 은 회수하지 않아 Edge Function 만 호출 가능)
REVOKE EXECUTE ON FUNCTION public.participant_login(TEXT, TEXT) FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Access Code 발급/재발급 (관리자 전용) — 평문 1회 반환
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_access_code(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
-- pgcrypto(crypt/gen_salt)는 Supabase 에서 extensions 스키마에 설치되므로 search_path 에 포함한다.
SET search_path = public, extensions
AS $$
DECLARE
    v_plain TEXT;
    v_target public.users%ROWTYPE;
BEGIN
    IF public.current_app_role() <> 'ADMIN' THEN
        RAISE EXCEPTION '권한이 없습니다: Access Code 발급은 관리자만 가능합니다.';
    END IF;

    SELECT * INTO v_target FROM public.users WHERE id = p_user_id AND deleted_at IS NULL;
    IF v_target.id IS NULL THEN
        RAISE EXCEPTION '대상 사용자를 찾을 수 없습니다.';
    END IF;
    IF v_target.role NOT IN ('EXPERT', 'STARTUP') THEN
        RAISE EXCEPTION 'Access Code 는 전문가/스타트업에게만 발급합니다.';
    END IF;

    v_plain := public.generate_access_code();

    UPDATE public.users SET
        access_code_hash = crypt(v_plain, gen_salt('bf')),
        access_code_issued_at = now(),
        session_version = session_version + 1  -- 기존 세션 무효화
    WHERE id = p_user_id;

    -- 평문은 반환만 하고 저장/로깅하지 않는다. 표시용 하이픈은 클라이언트에서 삽입.
    RETURN v_plain;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_access_code(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_access_code(UUID) TO authenticated;
