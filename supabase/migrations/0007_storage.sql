-- =============================================================================
-- 0007_storage.sql — Supabase Storage 버킷 + Signed URL 접근 정책
-- 출처: docs/security_transactions.md 2장, docs/page_admin_user_management.md 2.4
-- =============================================================================
-- 비공개 버킷 + 권한/만료가 적용된 Signed URL 로만 제공한다(공개 URL 금지).
-- 경로 규칙: {purpose}/{owner_user_id}/{filename}
--   - proposals/{startup_user_id}/...  : 스타트업 사업소개서 PDF
--   - avatars/{expert_user_id}/...      : 전문가 프로필 이미지
-- =============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('proposals', 'proposals', FALSE), ('avatars', 'avatars', FALSE)
ON CONFLICT (id) DO NOTHING;

-- 경로의 소유자 user_id 추출 헬퍼 (foldername: [1]=purpose, [2]=owner_id)
CREATE OR REPLACE FUNCTION public._storage_owner_id(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
    v_parts TEXT[] := storage.foldername(p_name);
BEGIN
    IF array_length(v_parts, 1) >= 2 THEN
        RETURN v_parts[2]::uuid;
    END IF;
    RETURN NULL;
EXCEPTION WHEN others THEN
    RETURN NULL;
END;
$$;

-- -----------------------------------------------------------------------------
-- proposals 버킷 정책 (스타트업 소개서)
--   읽기: 관리자/스태프, 소유 스타트업 본인, 같은 행사에서 매칭된 전문가
--   쓰기: 관리자, 소유 스타트업 본인
-- -----------------------------------------------------------------------------
CREATE POLICY proposals_read ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'proposals' AND (
        public.is_admin_or_staff()
        OR public._storage_owner_id(name) = public.current_app_user_id()
        OR public.shares_event_with(public._storage_owner_id(name))
    )
);
CREATE POLICY proposals_write ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'proposals' AND (
        public.current_app_role() = 'ADMIN'
        OR public._storage_owner_id(name) = public.current_app_user_id()
    )
);
CREATE POLICY proposals_update ON storage.objects FOR UPDATE TO authenticated
USING (
    bucket_id = 'proposals' AND (
        public.current_app_role() = 'ADMIN'
        OR public._storage_owner_id(name) = public.current_app_user_id()
    )
);
CREATE POLICY proposals_delete ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'proposals' AND (
        public.current_app_role() = 'ADMIN'
        OR public._storage_owner_id(name) = public.current_app_user_id()
    )
);

-- -----------------------------------------------------------------------------
-- avatars 버킷 정책 (전문가 프로필 사진)
--   읽기: 인증 사용자 전체(매칭된 스타트업에게 공개 프로필로 노출)
--   쓰기: 관리자, 소유 전문가 본인
-- -----------------------------------------------------------------------------
CREATE POLICY avatars_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'avatars');
CREATE POLICY avatars_write ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'avatars' AND (
        public.current_app_role() = 'ADMIN'
        OR public._storage_owner_id(name) = public.current_app_user_id()
    )
);
CREATE POLICY avatars_update ON storage.objects FOR UPDATE TO authenticated
USING (
    bucket_id = 'avatars' AND (
        public.current_app_role() = 'ADMIN'
        OR public._storage_owner_id(name) = public.current_app_user_id()
    )
);
CREATE POLICY avatars_delete ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'avatars' AND (
        public.current_app_role() = 'ADMIN'
        OR public._storage_owner_id(name) = public.current_app_user_id()
    )
);
