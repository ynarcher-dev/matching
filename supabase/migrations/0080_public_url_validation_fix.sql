-- =============================================================================
-- 0080_public_url_validation_fix.sql — 0079 _validate_public_url 오탐 교정
-- =============================================================================
-- 0079 의 host 차단 규칙 중 IPv6 ULA(fc00::/7)·link-local(fe80::/10) 판정을
-- `^[fF][cCdD]` / `^[fF][eE][89aAbB]` 로 **모든 host** 에 적용해, 콜론이 없는
-- 정상 도메인(fdj.fr, fcbarcelona.com, febreze.com 등 fc/fd/fe8~feb 로 시작)
-- 까지 오탐 차단하는 버그가 있었다.
--   → IPv6 판정은 콜론을 포함한 IPv6 리터럴 host 에만 적용하도록 게이트한다.
-- 나머지 정책(scheme allow-list, IPv4 사설/loopback/link-local, localhost/*.local)
-- 은 0079 와 동일. add_my_company_link / set_my_company_homepage 는 이 헬퍼를
-- 호출하므로 헬퍼만 교체하면 두 RPC 에 즉시 반영된다.
-- =============================================================================

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
       -- IPv6 리터럴(콜론 포함)에만 적용: loopback/unspecified/IPv4-mapped/ULA/link-local
       OR (position(':' IN v_host) > 0 AND (
              v_host = '::1'
              OR v_host = '::'
              OR v_host ~ '^::ffff:'
              OR v_host ~ '^[fF][cCdD]'        -- fc00::/7
              OR v_host ~ '^[fF][eE][89aAbB]'  -- fe80::/10
          ))
    THEN
        RAISE EXCEPTION '내부·사설 네트워크 주소는 등록할 수 없습니다.';
    END IF;

    RETURN v_url;
END;
$$;
REVOKE ALL ON FUNCTION public._validate_public_url(TEXT) FROM PUBLIC;
