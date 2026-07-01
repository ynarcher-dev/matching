-- =============================================================================
-- 0074_company_links_coparticipant_read.sql
-- =============================================================================
-- URL 공유(0073 company_links)를 매칭된 전문가에게도 노출.
--   0073 의 SELECT 정책은 본인 + 관리자/스태프만 허용해 전문가(co-participant)가
--   스타트업의 참고 URL·부연설명을 읽지 못했다. users(0003 users_select)·
--   proposal(users 임베드)과 동일하게 공유 행사 co-participant SELECT 를 추가한다.
--   → 전문가 Split View [링크] 탭에서 스타트업이 등록한 링크 목록(url+설명)을 열람.
-- =============================================================================

DROP POLICY IF EXISTS company_links_select ON public.company_links;

CREATE POLICY company_links_select ON public.company_links FOR SELECT TO authenticated
USING (
    user_id = public.current_app_user_id()
    OR public.is_admin_or_staff()
    OR public.shares_event_with(user_id)
);
