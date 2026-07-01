-- =============================================================================
-- 0068_proposal_file_name.sql — 사업소개서 원본 파일명을 users 에 동기화
-- 출처: 사용자 요청(2026-06-30) — 전문가 Split View [자료] 탭에 "사업소개서" 고정 라벨 대신
--   실제 업로드 파일명을 보여 달라.
-- =============================================================================
-- 배경/결정:
--   소개서 저장 경로는 업로드마다 고유(proposals/{id}/{uuid}.pdf, 0052)라 경로만으로는
--   원본 파일명을 알 수 없다. 원본명은 proposal_uploads.file_name 에만 있는데, 그 테이블의
--   RLS(0052)는 관리자/스태프 + 본인만 SELECT 를 허용해 전문가(co-participant)가 읽지 못한다.
--
--   전문가는 매칭된 스타트업의 users 행은 co-participant SELECT 로 이미 읽는다
--   (company_name·proposal_file_url 등). 따라서 원본 파일명을 users.proposal_file_name 으로
--   끌어올려 같은 경로로 노출한다(RLS 추가 없이 해결).
--
--   동기화: 업로드/교체/해제는 모두 proposal_uploads 에 한 행을 남긴다
--   (스타트업 자가 RPC set_my_proposal_file·관리자 대행 recordProposalHistory 양쪽).
--   그 INSERT 에 트리거를 걸어 users.proposal_file_name 을 최신 file_name 으로 맞춘다.
--   CLEAR(file_name NULL)면 NULL 로 비운다 — proposal_file_url 갱신과 정합.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 컬럼 추가 — 현재 소개서의 원본 파일명(없거나 백필 불가 시 NULL).
-- -----------------------------------------------------------------------------
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS proposal_file_name TEXT;

-- -----------------------------------------------------------------------------
-- 2. proposal_uploads INSERT → users.proposal_file_name 동기화 트리거.
--    file_path 와 무관하게 최신 이력의 file_name 을 그대로 반영(CLEAR 면 NULL).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_proposal_file_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.users
    SET proposal_file_name = NEW.file_name
    WHERE id = NEW.user_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_proposal_file_name ON public.proposal_uploads;
CREATE TRIGGER trg_sync_proposal_file_name
    AFTER INSERT ON public.proposal_uploads
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_proposal_file_name();

-- -----------------------------------------------------------------------------
-- 3. 백필 — 현재 소개서가 있는 스타트업마다, 그 경로(proposal_file_url)와 일치하는
--    가장 최근 이력 행의 file_name 을 채운다. 일치 행이 없으면(과거 백필 등) NULL 유지.
-- -----------------------------------------------------------------------------
UPDATE public.users u
SET proposal_file_name = pu.file_name
FROM (
    SELECT DISTINCT ON (user_id) user_id, file_path, file_name
    FROM public.proposal_uploads
    WHERE file_path IS NOT NULL
    ORDER BY user_id, uploaded_at DESC
) pu
WHERE pu.user_id = u.id
  AND u.proposal_file_url IS NOT NULL
  AND pu.file_path = u.proposal_file_url
  AND pu.file_name IS NOT NULL;
