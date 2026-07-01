-- =============================================================================
-- 0078_storage_file_size_limit.sql — Storage 업로드 용량 서버측 강제 (보안 A-3)
-- 근거: docs/security_remediation_plan.md A-3 (보완-02, Medium-High, P2)
-- =============================================================================
-- 문제: proposals/avatars/event-photos 버킷은 용량 제한이 클라이언트(JS)에만 있었다
--   (storage.ts PROPOSAL_MAX=10MB·AVATAR_MAX=50MB, companyPhoto.ts PHOTO_MAX_BYTES=8MB).
--   Signed upload URL 이나 REST 직접 호출로 클라이언트 검증을 우회하면 임의 대용량
--   파일을 올려 스토리지 용량·트래픽 비용을 유발할 수 있었다.
--
-- 조치: 각 버킷에 storage.buckets.file_size_limit(바이트)을 설정한다. 이 값은 Storage
--   API 가 업로드 시 Content-Length 기준으로 **서버측에서** 강제하므로, RLS·클라이언트
--   경로와 무관하게 한도 초과 업로드를 거부한다(413).
--
-- 값 선정(클라이언트 한도와 일치 — A-3 "주의: 클라이언트 한도와 값 일치"):
--   * proposals    10MB  = 10 * 1024 * 1024 = 10485760   (storage.ts PROPOSAL_MAX)
--   * avatars      50MB  = 50 * 1024 * 1024 = 52428800    (storage.ts AVATAR_MAX)
--   * event-photos  8MB  =  8 * 1024 * 1024 =  8388608    (companyPhoto.ts PHOTO_MAX_BYTES;
--       업로드 전 RESIZE_MAX_EDGE=1600 재인코딩으로 실제 업로드 blob 은 원본보다 작다)
--
-- 설계 메모: A-3 은 "RLS WITH CHECK 의 (metadata->>'size') 결합" 또는 "버킷
--   file_size_limit 설정" 두 방식을 제시한다. 후자를 택한 이유 —
--   (1) file_size_limit 은 객체 row INSERT 이전에 Content-Length 로 선검증되어,
--       INSERT 시점 metadata->>'size' 채워짐 여부(스토리지 버전 의존)에 흔들리지 않는다.
--   (2) Supabase 표준 메커니즘이라 RLS churn 없이 안전.
--   기존 proposals_write/avatars_write/event_photos_write RLS 는 변경하지 않는다.
-- =============================================================================

UPDATE storage.buckets SET file_size_limit = 10485760 WHERE id = 'proposals';
UPDATE storage.buckets SET file_size_limit = 52428800 WHERE id = 'avatars';
UPDATE storage.buckets SET file_size_limit =  8388608 WHERE id = 'event-photos';
