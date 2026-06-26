-- =============================================================================
-- 0023_public_comments.sql
--   스타트업이 "본인 상담" 중 전문가가 공개를 허용한 텍스트 코멘트만 조회한다.
--   내부 평가 점수(score_*)는 절대 노출하지 않는다.
-- 출처: docs/page_startup_booking.md §2.5 (공개 상담 코멘트 / 점수 비공개)
-- =============================================================================
-- 배경: counseling_logs 의 행 접근은 clog_select RLS(공개분+본인 슬롯)로 통제되지만,
--   행이 노출되면 점수 컬럼까지 SELECT 가능하다(0003_rls.sql 주석의 "노출용 뷰" 미구현).
--   여기서는 SECURITY DEFINER 로 안전 컬럼만 반환해 점수 컬럼 노출 경로 자체를 차단한다.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.list_public_comments(p_event_id UUID)
RETURNS TABLE (
    slot_id      UUID,
    expert_id    UUID,
    expert_name  TEXT,
    start_time   TIMESTAMPTZ,
    content      TEXT,
    submitted_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT s.id, s.expert_id, u.name::TEXT, s.start_time, cl.content, cl.submitted_at
    FROM public.counseling_logs cl
    JOIN public.matching_slots s ON s.id = cl.matching_slot_id
    JOIN public.users u ON u.id = s.expert_id
    WHERE s.event_id = p_event_id
      AND s.startup_id = public.current_app_user_id()
      AND cl.is_public = TRUE
      AND cl.content IS NOT NULL
      AND length(btrim(cl.content)) > 0
    ORDER BY s.start_time;
$$;

-- Supabase 기본 권한은 public 스키마 신규 함수의 EXECUTE 를 anon 에도 명시 부여한다.
-- FROM PUBLIC 회수만으로는 그 anon 직접 권한이 남으므로 anon 을 명시 회수한다(최소 권한).
REVOKE ALL ON FUNCTION public.list_public_comments(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_public_comments(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_public_comments(UUID) TO authenticated;
