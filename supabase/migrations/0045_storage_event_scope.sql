-- =============================================================================
-- 0045_storage_event_scope.sql — event-photos 스토리지 객체 RLS 행사 범위화 (B-1 후속)
-- 출처: docs/page_admin_operator_permissions.md §3.2, docs/worklog_operator_permissions.md §2.3
-- =============================================================================
-- 0036 의 event-photos 버킷 객체 정책은 전역 is_admin_or_staff() 였다. company_photos
-- 테이블 RLS 는 0042 에서 can_staff_event 로 좁혔으므로, 스토리지 객체 정책도 동일 기준
-- 으로 맞춰 미배정 행사 사진 파일 접근을 차단한다.
--
-- 경로 규칙(0036): event-photos/{event_id}/{company_user_id}/{file}
--   → storage.foldername(name)[1] = event_id, [2] = company_user_id.
--
-- 안전성: event_id 추출 헬퍼는 0007 _storage_owner_id 와 동일하게 EXCEPTION→NULL 로
--   캐스팅 실패를 흡수한다(비정상 경로에서 정책 throw 없음 → 전원 접근 깨짐 방지).
--   NULL event_id 는 can_staff_event(NULL)=FALSE(0017/0039 NULL-안전) 로 거부되며,
--   최고관리자는 헬퍼를 무조건 통과하므로 무중단.
-- =============================================================================

-- 경로의 행사 식별자 추출 (event-photos: foldername[1] = event_id)
CREATE OR REPLACE FUNCTION public._event_photo_event_id(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
    v_parts TEXT[] := storage.foldername(p_name);
BEGIN
    IF array_length(v_parts, 1) >= 1 THEN
        RETURN v_parts[1]::uuid;
    END IF;
    RETURN NULL;
EXCEPTION WHEN others THEN
    RETURN NULL;
END;
$$;

-- -----------------------------------------------------------------------------
-- event-photos 버킷 정책 재생성
--   읽기: 행사 현장 권한(can_staff_event) 또는 소유 기업 본인.
--   쓰기/수정/삭제: 행사 현장 권한(can_staff_event).
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS event_photos_read ON storage.objects;
CREATE POLICY event_photos_read ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'event-photos' AND (
        public.can_staff_event(public._event_photo_event_id(name))
        OR public._storage_owner_id(name) = public.current_app_user_id()
    )
);

DROP POLICY IF EXISTS event_photos_write ON storage.objects;
CREATE POLICY event_photos_write ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'event-photos'
    AND public.can_staff_event(public._event_photo_event_id(name))
);

DROP POLICY IF EXISTS event_photos_update ON storage.objects;
CREATE POLICY event_photos_update ON storage.objects FOR UPDATE TO authenticated
USING (
    bucket_id = 'event-photos'
    AND public.can_staff_event(public._event_photo_event_id(name))
);

DROP POLICY IF EXISTS event_photos_delete ON storage.objects;
CREATE POLICY event_photos_delete ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'event-photos'
    AND public.can_staff_event(public._event_photo_event_id(name))
);
