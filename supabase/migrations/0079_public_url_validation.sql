-- =============================================================================
-- 0079_public_url_validation.sql — 사용자 제출 URL 서버측 검증 (감사 E-1, P1)
-- =============================================================================
-- 스타트업이 저장하는 참고 URL(company_links.url) 및 대표 홈페이지
-- (users.company_homepage)를 서버(RPC)에서 검증·정규화한다.
-- 프론트 normalizeUrl 은 UX 보조일 뿐이며, 서버가 최종 게이트다.
--
-- 쓰기 경로(현행 확인):
--   * company_links 는 SELECT RLS 만 존재 → INSERT/UPDATE 는 default-deny.
--     쓰기는 add_my_company_link / delete_my_company_link(SECURITY DEFINER)만.
--   * users.company_homepage 는 set_my_company_homepage / _sync_company_homepage
--     로만 사용자 입력이 반영된다.
--   → 따라서 add_my_company_link 와 set_my_company_homepage 두 지점만 게이트하면
--     사용자 입력 URL 전량이 검증을 통과한다.
--
-- 정책:
--   * scheme allow-list: http, https 만 허용. javascript:/data:/file:/vbscript:/
--     mailto: 등 그 외 scheme 은 거부. scheme 없으면 https:// 로 정규화.
--   * host 차단: localhost / *.localhost / *.local,
--     IPv4 loopback·사설·link-local·this-network
--       (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 0/8),
--     IPv6 loopback(::1)/unspecified(::)/IPv4-mapped(::ffff:)/ULA(fc00::/7)/
--       link-local(fe80::/10).
--   * 제어문자·공백 포함 거부(스킴/헤더 인젝션 방지).
--
-- 주의: 기존 저장 행(0073 백필분 포함)은 소급 검증·삭제하지 않는다(정상 http
--       링크 손상 위험). 신규 쓰기부터 게이트한다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 공통 검증·정규화 헬퍼 — 유효하면 정규화된 URL 반환, 아니면 RAISE.
--    순수 함수(테이블 미참조) → IMMUTABLE. 정의자 RPC 내부에서만 호출.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._validate_public_url(p_url TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
DECLARE
    v_url  TEXT := btrim(COALESCE(p_url, ''));
    v_auth TEXT;
    v_host TEXT;
BEGIN
    IF v_url = '' THEN
        RAISE EXCEPTION 'URL 을 입력해 주세요.';
    END IF;

    -- 제어문자·공백 차단(스킴 우회·헤더 인젝션 방지)
    IF v_url ~ '[[:space:][:cntrl:]]' THEN
        RAISE EXCEPTION 'URL 에 공백·제어문자를 포함할 수 없습니다.';
    END IF;

    -- scheme 검증·정규화
    IF v_url ~* '^https?://' THEN
        NULL;  -- http/https 그대로 진행
    ELSIF v_url ~ '^[A-Za-z][A-Za-z0-9+.-]*:' THEN
        -- http(s) 아닌 다른 scheme(javascript:, data:, file:, mailto: 등) → 거부
        RAISE EXCEPTION 'http:// 또는 https:// URL 만 등록할 수 있습니다.';
    ELSE
        -- scheme 없음 → https 로 정규화(프론트 normalizeUrl 과 동일 규칙)
        v_url := 'https://' || v_url;
    END IF;

    -- authority 추출: scheme:// 다음, 첫 / ? # 이전
    v_auth := substring(v_url from '^https?://([^/?#]+)');
    IF v_auth IS NULL OR v_auth = '' THEN
        RAISE EXCEPTION '올바른 URL 형식이 아닙니다.';
    END IF;

    -- userinfo(user:pass@) 제거 → 마지막 @ 뒤가 실제 host[:port]
    IF position('@' IN v_auth) > 0 THEN
        v_auth := substring(v_auth from '([^@]+)$');
    END IF;

    -- host 추출: IPv6 [..] 또는 host[:port]
    IF left(v_auth, 1) = '[' THEN
        v_host := lower(substring(v_auth from '^\[([^\]]+)\]'));
    ELSE
        v_host := lower(substring(v_auth from '^([^:]+)'));
    END IF;

    IF v_host IS NULL OR v_host = '' THEN
        RAISE EXCEPTION '올바른 URL 형식이 아닙니다.';
    END IF;

    -- 내부·사설 네트워크 차단
    IF v_host = 'localhost'
       OR v_host ~ '\.localhost$'
       OR v_host ~ '\.local$'
       -- IPv4 loopback / private / link-local / this-network
       OR v_host ~ '^127\.'
       OR v_host ~ '^10\.'
       OR v_host ~ '^192\.168\.'
       OR v_host ~ '^172\.(1[6-9]|2[0-9]|3[0-1])\.'
       OR v_host ~ '^169\.254\.'
       OR v_host ~ '^0\.'
       -- IPv6 loopback / unspecified / IPv4-mapped / ULA(fc00::/7) / link-local(fe80::/10)
       OR v_host = '::1'
       OR v_host = '::'
       OR v_host ~ '^::ffff:'
       OR v_host ~ '^[fF][cCdD]'
       OR v_host ~ '^[fF][eE][89aAbB]'
    THEN
        RAISE EXCEPTION '내부·사설 네트워크 주소는 등록할 수 없습니다.';
    END IF;

    RETURN v_url;
END;
$$;
REVOKE ALL ON FUNCTION public._validate_public_url(TEXT) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 2. add_my_company_link 재정의 — 길이 검사 후 _validate_public_url 로 정규화.
--    (0073 본문 유지 + URL 검증 결합)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_my_company_link(p_url TEXT, p_label TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid   UUID := public.current_app_user_id();
    v_url   TEXT := NULLIF(btrim(COALESCE(p_url, '')), '');
    v_label TEXT := NULLIF(btrim(COALESCE(p_label, '')), '');
    v_count INT;
    v_id    UUID;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION '인증이 필요합니다.'; END IF;
    IF v_url IS NULL THEN RAISE EXCEPTION 'URL 을 입력해 주세요.'; END IF;
    IF char_length(v_url) > 500 THEN RAISE EXCEPTION 'URL 은 500자 이하로 입력해 주세요.'; END IF;
    IF v_label IS NOT NULL AND char_length(v_label) > 100 THEN
        RAISE EXCEPTION '설명은 100자 이하로 입력해 주세요.';
    END IF;

    -- 서버측 URL 검증·정규화(scheme/host allow-list). 유효하지 않으면 RAISE.
    v_url := public._validate_public_url(v_url);

    SELECT count(*) INTO v_count FROM public.company_links WHERE user_id = v_uid;
    IF v_count >= 20 THEN
        RAISE EXCEPTION '참고 URL 은 최대 20개까지 등록할 수 있습니다.';
    END IF;

    INSERT INTO public.company_links (user_id, url, label)
    VALUES (v_uid, v_url, v_label)
    RETURNING id INTO v_id;

    PERFORM public._sync_company_homepage(v_uid);
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.add_my_company_link(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_my_company_link(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.add_my_company_link(TEXT, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. set_my_company_homepage 재정의 — 값이 있으면 _validate_public_url 로 정규화.
--    (0066 본문 유지 + URL 검증 결합. NULL/빈값은 홈페이지 해제로 계속 허용.)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_my_company_homepage(p_homepage TEXT)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_clean TEXT := NULLIF(btrim(COALESCE(p_homepage, '')), '');
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION '인증이 필요합니다.'; END IF;
    IF v_clean IS NOT NULL THEN
        IF char_length(v_clean) > 255 THEN
            RAISE EXCEPTION '참고 URL 은 255자 이하로 입력해 주세요.';
        END IF;
        v_clean := public._validate_public_url(v_clean);
    END IF;
    UPDATE public.users SET company_homepage = v_clean WHERE id = v_uid;
END;
$$;
REVOKE ALL ON FUNCTION public.set_my_company_homepage(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_company_homepage(TEXT) TO authenticated;
