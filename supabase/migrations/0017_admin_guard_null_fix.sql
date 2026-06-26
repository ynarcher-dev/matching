-- =============================================================================
-- 0017_admin_guard_null_fix.sql — 관리자 가드 NULL 우회 전역 차단 (보안)
-- 출처: docs/worklog_phase4_slice5.md "내일 먼저 볼 것" 보안 관찰
-- =============================================================================
-- 발견된 빈틈:
--   관리자 전용 RPC 가드는 `IF current_app_role() <> 'ADMIN' THEN RAISE` 패턴을 쓴다.
--   역할이 매핑되지 않은 호출자(미매핑 authenticated 토큰 등)에게 current_app_role()
--   은 NULL 을 반환했고, `NULL <> 'ADMIN'` = NULL → plpgsql 의 `IF NULL` 은 거짓 처리라
--   RAISE 가 실행되지 않아 가드가 우회되었다(함수 본문까지 도달).
--   * 정상 참가자(EXPERT/STARTUP)는 role 이 'ADMIN' 이 아니므로 원래부터 정상 차단됨.
--     문제는 role 이 NULL 로 해석되는 호출자뿐.
--
-- 처방(중앙 수정, 최저 드리프트):
--   current_app_role() 이 매핑 없는 호출자에게 NULL 대신 비역할 센티넬 'NONE' 을
--   반환하도록 한 곳만 바꾼다. 그러면 'NONE' <> 'ADMIN' = TRUE 로 평가되어 기존/신규의
--   모든 가드(`<> 'ADMIN'`, `<> 'STARTUP'`, `IN ('ADMIN','STAFF')`, RLS `= 'ADMIN'`)가
--   자동으로 "거부" 방향으로 닫힌다. 함수 본문을 일일이 재작성하지 않아 드리프트가 없다.
--
-- 안전성 검토(전체 사용처):
--   `= 'ADMIN'`/`= 'STARTUP'`(RLS·가드) → 'NONE' 불일치 → 거부(정상)
--   `<> 'ADMIN'`/`<> 'STARTUP'`         → 'NONE' 불일치 → TRUE → RAISE(차단)
--   `IN ('ADMIN','STAFF')`/check_in 등   → 'NONE' 미포함 → 거부(정상)
--   NULL 자체에 의존하는 코드 없음(IS NULL 비교 부재) → 시맨틱 변화 없음.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    -- 매핑 없는 호출자는 NULL 대신 'NONE' 센티넬을 돌려준다(가드 NULL 우회 차단).
    SELECT COALESCE(
        (SELECT role FROM public.users WHERE id = public.current_app_user_id()),
        'NONE'
    );
$$;

REVOKE ALL ON FUNCTION public.current_app_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_app_role() TO authenticated;
