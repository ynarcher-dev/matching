-- =============================================================================
-- 0010_otp_grants.sql — OTP RPC 의 service_role EXECUTE 명시 부여
-- 출처: 0009_otp_auth.sql 후속 (라이브 배포 중 발견)
-- =============================================================================
-- 배경:
--   이 프로젝트는 2026-05-30 부터 "public 신규 객체 기본 권한 회수(revoke-by-default)"
--   클라우드 기본값을 따른다(config.toml `auto_expose_new_tables` 설명 참고).
--   그래서 0009 의 `REVOKE ALL ON FUNCTION ... FROM PUBLIC` 이후 service_role 의
--   암묵적 EXECUTE 까지 사라져, Edge Function(service_role) 의 RPC 호출이
--   `42501 permission denied` → Edge 500 으로 실패했다.
--
-- 조치:
--   Edge 가 직접 호출하는 두 진입점 RPC 에만 service_role EXECUTE 를 명시 부여한다.
--   (anon/authenticated 는 계속 거부. 내부에서만 호출되는
--    match_participant_by_identifier 는 SECURITY DEFINER 함수의 소유자 권한으로
--    실행되므로 별도 grant 불필요.)
-- =============================================================================

GRANT EXECUTE ON FUNCTION public.request_participant_otp(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_participant_otp(TEXT, TEXT) TO service_role;
