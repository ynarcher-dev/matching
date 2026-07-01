-- =============================================================================
-- 0067_fix_storage_owner_id.sql — storage.objects 소유자 식별자(UUID) 추출 로직 오류 수정
-- =============================================================================
-- 기존 0007 에서 정의된 public._storage_owner_id(p_name TEXT) 함수는
-- proposals 버킷과 avatars 버킷의 객체 경로(name)가 버킷명 접두사 없이
-- {userId}/{filename} 형태로 저장됨에도 불구하고, foldername()[2] (즉 v_parts[2])를
-- 소유자 UUID로 추출하고 있었습니다. 이로 인해 proposals/avatars의 _storage_owner_id는
-- 항상 NULL을 반환하였고, 결과적으로 authenticated 참가자(전문가/스타트업)가 본인의
-- 사업소개서 또는 매칭된 스타트업의 소개서 단기 Signed URL을 발급받을 때 RLS SELECT 정책
-- (proposals_read)을 통과하지 못해 HTTP 400 Bad Request 에러가 발생했습니다.
--
-- [수정 내용]
--   - v_parts 배열의 길이가 1인 경우 (즉 {userId}/filename) -> v_parts[1]::uuid 반환
--   - v_parts 배열의 길이가 2 이상인 경우 (즉 {eventId}/{userId}/filename) -> v_parts[2]::uuid 반환
-- =============================================================================

CREATE OR REPLACE FUNCTION public._storage_owner_id(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
    v_parts TEXT[] := storage.foldername(p_name);
BEGIN
    IF array_length(v_parts, 1) = 1 THEN
        RETURN v_parts[1]::uuid;
    ELSIF array_length(v_parts, 1) >= 2 THEN
        RETURN v_parts[2]::uuid;
    END IF;
    RETURN NULL;
EXCEPTION WHEN others THEN
    RETURN NULL;
END;
$$;
