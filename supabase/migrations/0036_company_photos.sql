-- =============================================================================
-- 0036_company_photos.sql — 현장담당자 기업별 현장 사진 업로드
-- 출처: docs/staff_company_photo_upload.md, docs/security_transactions.md 2장
-- =============================================================================
-- 2026-06-26 신규 기능:
--   현장담당자(STAFF)/관리자(ADMIN)가 행사별로 참가 기업(STARTUP)의 현장 사진을
--   여러 장 업로드하고, 관리자는 행사 상세에서 기업별 등록 현황·누락 기업을 확인한다.
--   외부 API 비용 없음(Supabase Storage 용량/트래픽만). 클라이언트 리사이즈로 용량 절감.
--
-- 확정 사항(기획 §8 미결정 해소, 2026-06-26):
--   * 사진 대상 = 행사 참가 STARTUP 기업(event_id + company_user_id), 행사별로 누적.
--   * 업로드 범위 = 행사의 모든 참가 기업(담당 구역 제한 없음 — 인프라 미존재).
--   * 삭제 = soft delete(deleted_at) + 클라이언트가 스토리지 객체도 제거(용량 절감).
--
-- 경로 규칙(0007 _storage_owner_id 재사용): event-photos/{event_id}/{company_user_id}/{file}
--   → storage.foldername()[2] = company_user_id 가 소유 기업. 기업 본인 읽기 판정에 사용.
--
-- 권한 메모:
--   * 테이블은 PostgREST auto-expose + RLS 로 게이트한다(이 프로젝트의 테이블 관례 —
--     별도 GRANT 불필요. revoke-by-default 는 함수 EXECUTE 에만 해당, 0010 참고).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Storage 버킷 — event-photos (비공개)
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-photos', 'event-photos', FALSE)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. 테이블 — company_photos (db_schema 신규)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    company_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    uploaded_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    storage_path TEXT NOT NULL,
    original_file_name TEXT,
    content_type TEXT,
    file_size INTEGER,
    taken_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- 행사+기업별 활성 사진 조회/집계용.
CREATE INDEX IF NOT EXISTS idx_company_photos_event
    ON public.company_photos (event_id, company_user_id, created_at DESC)
    WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- 3. RLS — company_photos
--   조회: 관리자/스태프 전체, 기업 본인(자기 사진만).
--   업로드: 관리자/스태프, uploaded_by=본인, 대상이 해당 행사의 STARTUP 참가자일 때만.
--   수정(soft delete): 관리자/스태프.
--   (DELETE 정책 미생성 = 물리 삭제는 RLS 거부. soft delete=UPDATE 로만.)
-- -----------------------------------------------------------------------------
ALTER TABLE public.company_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_photos_select ON public.company_photos FOR SELECT TO authenticated
USING (
    public.is_admin_or_staff()
    OR company_user_id = public.current_app_user_id()
);

CREATE POLICY company_photos_insert ON public.company_photos FOR INSERT TO authenticated
WITH CHECK (
    public.is_admin_or_staff()
    AND uploaded_by = public.current_app_user_id()
    AND EXISTS (
        SELECT 1 FROM public.event_participants ep
        WHERE ep.event_id = company_photos.event_id
          AND ep.user_id = company_photos.company_user_id
          AND ep.participant_type = 'STARTUP'
    )
);

CREATE POLICY company_photos_update ON public.company_photos FOR UPDATE TO authenticated
USING (public.is_admin_or_staff())
WITH CHECK (public.is_admin_or_staff());

-- -----------------------------------------------------------------------------
-- 4. Storage 정책 — event-photos 버킷
--   읽기: 관리자/스태프, 소유 기업 본인(_storage_owner_id = 본인).
--   쓰기/수정/삭제: 관리자/스태프(현장 업로드·검수·재촬영·삭제).
--   (일반 참가자는 타 기업 사진 접근 불가 — 기본 deny + 위 조건만.)
-- -----------------------------------------------------------------------------
CREATE POLICY event_photos_read ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'event-photos' AND (
        public.is_admin_or_staff()
        OR public._storage_owner_id(name) = public.current_app_user_id()
    )
);
CREATE POLICY event_photos_write ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'event-photos' AND public.is_admin_or_staff());
CREATE POLICY event_photos_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'event-photos' AND public.is_admin_or_staff());
CREATE POLICY event_photos_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'event-photos' AND public.is_admin_or_staff());
