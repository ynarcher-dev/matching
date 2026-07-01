-- =============================================================================
-- 0076_storage_owner_path_strict.sql — proposals/avatars 소유자 경로 파싱 우회 차단
-- 근거: docs/security_service_audit_supplement.md [보완-01] (High, P1),
--       docs/security_remediation_plan.md A-2
-- =============================================================================
-- [문제]
--   proposals/avatars 버킷의 객체 경로 규칙은 `{owner_user_id}/{filename}` (depth-1)이다.
--   그러나 소유자 추출 헬퍼 public._storage_owner_id(name) 는 foldername 길이가
--   2 이상이면 v_parts[2] 를 소유자로 반환한다(event-photos 의 depth-2 경로를 위해 필요).
--   이 때문에 공격자가 API 로 직접 경로를 `{victim_uuid}/{attacker_uuid}/x.pdf` 처럼
--   조작해 업로드하면 _storage_owner_id 가 v_parts[2]=attacker 를 반환하여
--   RLS `_storage_owner_id(name) = current_app_user_id()` 가드를 통과하고, 결과적으로
--   피해자 폴더 하위(namespace)에 파일을 밀어 넣거나 조작할 수 있다(경로 변조 우회).
--
-- [수정]
--   depth-1 전용 엄격 추출기 public._storage_owner_id_strict(name) 를 신설한다.
--   - foldername 세그먼트가 정확히 1개일 때만( `{owner}/{filename}` ) v_parts[1] 을 반환.
--   - 세그먼트가 0개(폴더 없음)이거나 2개 이상(깊이 우회)이면 NULL → RLS 거부.
--   proposals_*/avatars_write/update/delete 정책이 이 엄격 추출기를 쓰도록 재생성하고,
--   소유자 본인 쓰기 분기에는 starts_with(name, uid || '/') 앵커를 추가로 결합한다.
--
--   ⚠️ 전역 _storage_owner_id 는 그대로 둔다. event-photos 정책(0045)이 depth-2 경로
--      `{event_id}/{owner}/...` 에서 v_parts[2] 를 소유자로 쓰므로 변경 시 회귀 발생.
--      event-photos 는 본 조치 범위(보완-01: proposals/avatars) 밖이라 손대지 않는다.
--
-- [정상 경로 보존]
--   proposals: `{userId}/{uuid}.pdf`  → foldername=['{userId}'] length 1 → 통과.
--   avatars  : `{userId}/avatar.{ext}` → foldername=['{userId}'] length 1 → 통과.
--   공격 경로: `{victim}/{attacker}/x.pdf` → length 2 → strict NULL → 거부.
-- =============================================================================

-- depth-1 소유자 엄격 추출: 경로가 정확히 `{uuid}/{filename}` 일 때만 소유자 UUID 반환.
CREATE OR REPLACE FUNCTION public._storage_owner_id_strict(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
    v_parts TEXT[] := storage.foldername(p_name);
BEGIN
    -- 폴더 세그먼트가 정확히 1개가 아니면(0개=폴더없음, 2개+=깊이우회) 거부.
    IF array_length(v_parts, 1) IS DISTINCT FROM 1 THEN
        RETURN NULL;
    END IF;
    RETURN v_parts[1]::uuid;  -- uuid 캐스팅 실패는 EXCEPTION→NULL 로 흡수.
EXCEPTION WHEN others THEN
    RETURN NULL;
END;
$$;

-- -----------------------------------------------------------------------------
-- proposals 버킷 정책 재생성 (엄격 소유자 추출 적용)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS proposals_read ON storage.objects;
CREATE POLICY proposals_read ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'proposals' AND (
        public.is_admin_or_staff()
        OR public._storage_owner_id_strict(name) = public.current_app_user_id()
        OR public.shares_event_with(public._storage_owner_id_strict(name))
    )
);

DROP POLICY IF EXISTS proposals_write ON storage.objects;
CREATE POLICY proposals_write ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'proposals' AND (
        public.current_app_role() = 'ADMIN'
        OR (
            public._storage_owner_id_strict(name) = public.current_app_user_id()
            AND starts_with(name, public.current_app_user_id()::text || '/')
        )
    )
);

DROP POLICY IF EXISTS proposals_update ON storage.objects;
CREATE POLICY proposals_update ON storage.objects FOR UPDATE TO authenticated
USING (
    bucket_id = 'proposals' AND (
        public.current_app_role() = 'ADMIN'
        OR (
            public._storage_owner_id_strict(name) = public.current_app_user_id()
            AND starts_with(name, public.current_app_user_id()::text || '/')
        )
    )
);

DROP POLICY IF EXISTS proposals_delete ON storage.objects;
CREATE POLICY proposals_delete ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'proposals' AND (
        public.current_app_role() = 'ADMIN'
        OR (
            public._storage_owner_id_strict(name) = public.current_app_user_id()
            AND starts_with(name, public.current_app_user_id()::text || '/')
        )
    )
);

-- -----------------------------------------------------------------------------
-- avatars 버킷 정책 재생성 (읽기는 전체 공개 유지, 쓰기 계열만 엄격화)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS avatars_write ON storage.objects;
CREATE POLICY avatars_write ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'avatars' AND (
        public.current_app_role() = 'ADMIN'
        OR (
            public._storage_owner_id_strict(name) = public.current_app_user_id()
            AND starts_with(name, public.current_app_user_id()::text || '/')
        )
    )
);

DROP POLICY IF EXISTS avatars_update ON storage.objects;
CREATE POLICY avatars_update ON storage.objects FOR UPDATE TO authenticated
USING (
    bucket_id = 'avatars' AND (
        public.current_app_role() = 'ADMIN'
        OR (
            public._storage_owner_id_strict(name) = public.current_app_user_id()
            AND starts_with(name, public.current_app_user_id()::text || '/')
        )
    )
);

DROP POLICY IF EXISTS avatars_delete ON storage.objects;
CREATE POLICY avatars_delete ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'avatars' AND (
        public.current_app_role() = 'ADMIN'
        OR (
            public._storage_owner_id_strict(name) = public.current_app_user_id()
            AND starts_with(name, public.current_app_user_id()::text || '/')
        )
    )
);

REVOKE ALL ON FUNCTION public._storage_owner_id_strict(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._storage_owner_id_strict(TEXT) TO authenticated;
