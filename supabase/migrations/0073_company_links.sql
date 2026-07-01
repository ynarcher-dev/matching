-- =============================================================================
-- 0073_company_links.sql — 스타트업 참고 URL 다중 관리(부연설명 포함)
-- =============================================================================
-- 자료 첨부 §3 "URL 공유" 개편:
--   단일 users.company_homepage → 여러 링크(url + 설명)를 ADD/DELETE 로 관리.
--   기존 company_homepage 는 "대표 URL"(가장 먼저 등록된 링크)로 계속 동기화되어
--   관리자 상세·전문가 Split View·내보내기·CSV 등 기존 소비처는 변경 없이 동작한다.
--
-- 권한 메모:
--   * 테이블은 PostgREST auto-expose + RLS 로 게이트(테이블 관례, 별도 GRANT 불필요).
--   * 쓰기는 SECURITY DEFINER RPC(add/delete)로만. 신규 함수는 anon EXECUTE 를
--     명시 회수([[rpc-revoke-anon-grant]] 규칙).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 테이블 — company_links
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    label TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_company_links_user
    ON public.company_links (user_id, created_at);

-- -----------------------------------------------------------------------------
-- 2. RLS — 본인 SELECT + 관리자/스태프 SELECT(상세 열람). 쓰기는 RPC 로만.
-- -----------------------------------------------------------------------------
ALTER TABLE public.company_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_links_select ON public.company_links FOR SELECT TO authenticated
USING (
    user_id = public.current_app_user_id()
    OR public.is_admin_or_staff()
);

-- -----------------------------------------------------------------------------
-- 3. 대표 URL 동기화 헬퍼 — 가장 먼저 등록된 링크를 users.company_homepage 로 반영.
--    내부 헬퍼(다른 SECURITY DEFINER RPC 에서만 호출) → authenticated 직접 실행 불필요.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._sync_company_homepage(p_uid UUID)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    UPDATE public.users u
    SET company_homepage = (
        SELECT cl.url FROM public.company_links cl
        WHERE cl.user_id = p_uid
        ORDER BY cl.created_at, cl.id
        LIMIT 1
    )
    WHERE u.id = p_uid;
END;
$$;
REVOKE ALL ON FUNCTION public._sync_company_homepage(UUID) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 4. 링크 추가 RPC (본인, url 필수·설명 선택, 최대 20개)
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
-- 5. 링크 삭제 RPC (본인 소유 행만)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_my_company_link(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION '인증이 필요합니다.'; END IF;
    DELETE FROM public.company_links WHERE id = p_id AND user_id = v_uid;
    PERFORM public._sync_company_homepage(v_uid);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_my_company_link(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_my_company_link(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_my_company_link(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. 백필 — 기존 company_homepage 를 대표 링크 1건으로 이관(링크 없는 사용자만).
-- -----------------------------------------------------------------------------
INSERT INTO public.company_links (user_id, url, label)
SELECT u.id, btrim(u.company_homepage), NULL
FROM public.users u
WHERE NULLIF(btrim(COALESCE(u.company_homepage, '')), '') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.company_links cl WHERE cl.user_id = u.id);
