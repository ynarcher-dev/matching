-- =============================================================================
-- 0024_revoke_public_comments_anon.sql
--   0023 의 list_public_comments 에서 anon EXECUTE 권한을 명시 회수한다.
--   (0023 은 FROM PUBLIC 만 회수해 Supabase 기본 anon 직접 권한이 남아 있었다.
--    이미 적용된 0023 은 db push 가 재실행하지 않으므로 별도 마이그레이션으로 보정한다.)
-- 검증: anon RPC 호출이 200 [] → 42501(permission denied)로 차단되는지 확인.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.list_public_comments(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_public_comments(UUID) TO authenticated;
