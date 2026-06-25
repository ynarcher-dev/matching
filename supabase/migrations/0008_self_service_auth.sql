-- =============================================================================
-- 0008_self_service_auth.sql — Access Code 셀프 재발송 빌딩블록
-- 출처: docs/page_auth_layout.md §1.3(분실 시 셀프 재발송) / §1.4(재발급 정책)
-- =============================================================================
-- 미인증 사용자가 본인 등록 이메일로 새 Access Code 를 발송받는 경로.
-- issue_access_code 는 관리자(current_app_role='ADMIN') 전용이라 이 흐름에서 못 쓴다.
-- 별도 SECURITY DEFINER RPC 를 두되, Edge Function(service_role) 만 호출하도록 막는다.
--
-- 보안 메모(2026-06-25 교훈 재적용):
--   Supabase 는 public 함수에 anon/authenticated EXECUTE 를 기본 부여하므로
--   REVOKE FROM PUBLIC 만으로는 부족하다 → anon, authenticated 를 명시 회수한다.
--   (service_role 은 회수하지 않아 Edge Function 만 호출 가능)
--   평문 코드는 service_role(Edge)에게만 반환되며, DB/로그에는 저장하지 않는다.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reissue_access_code_self(p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
-- pgcrypto(crypt/gen_salt)는 Supabase 에서 extensions 스키마에 설치되므로 포함한다.
SET search_path = public, extensions
AS $$
DECLARE
    v_email TEXT := lower(btrim(coalesce(p_email, '')));
    v_plain TEXT;
    v_target public.users%ROWTYPE;
BEGIN
    IF v_email = '' THEN
        RETURN NULL;
    END IF;

    -- 활성 전문가/스타트업만 대상. 존재 여부는 호출부(Edge)가 노출하지 않는다(계정 열거 방지).
    SELECT * INTO v_target
    FROM public.users u
    WHERE u.deleted_at IS NULL
      AND u.role IN ('EXPERT', 'STARTUP')
      AND lower(u.email) = v_email
    LIMIT 1;

    IF v_target.id IS NULL THEN
        RETURN NULL;
    END IF;

    v_plain := public.generate_access_code();

    UPDATE public.users SET
        access_code_hash = crypt(v_plain, gen_salt('bf')),
        access_code_issued_at = now(),
        session_version = session_version + 1  -- 재발급 즉시 기존 코드/세션 무효화
    WHERE id = v_target.id;

    -- 평문은 반환만(알림 발송용). 저장/로깅 금지.
    RETURN v_plain;
END;
$$;

REVOKE ALL ON FUNCTION public.reissue_access_code_self(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reissue_access_code_self(TEXT) FROM anon, authenticated;
