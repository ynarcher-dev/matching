-- =============================================================================
-- 0041_admin_list_operators.sql — 운영자 목록 조회 RPC (부가기능 슬라이스 D)
-- 출처: docs/page_admin_operator_permissions.md 4.2
-- =============================================================================
-- users_select RLS 는 deleted_at IS NULL 만 노출하므로 비활성(soft delete) 운영자가
-- 목록에서 사라진다. 최고관리자 전용 SECURITY DEFINER 조회로 비활성 포함 + 배정 행사
-- 수 + 최근 로그인까지 한 번에 반환한다(참가자용 admin_participant_auth_overview 패턴).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_list_operators()
RETURNS TABLE (
    id                   UUID,
    email                TEXT,
    name                 TEXT,
    role                 TEXT,
    is_super_admin       BOOLEAN,
    active               BOOLEAN,
    created_at           TIMESTAMPTZ,
    last_sign_in_at      TIMESTAMPTZ,
    assigned_event_count BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT
        u.id,
        u.email::text,
        u.name::text,
        u.role::text,
        u.is_super_admin,
        (u.deleted_at IS NULL) AS active,
        u.created_at,
        au.last_sign_in_at,
        (
            SELECT count(*)
            FROM public.event_operator_roles r
            WHERE r.user_id = u.id AND r.revoked_at IS NULL
        ) AS assigned_event_count
    FROM public.users u
    LEFT JOIN auth.users au ON au.id = u.auth_user_id
    -- 최고관리자만 결과를 받는다(비최고관리자는 빈 집합).
    WHERE public.is_super_admin()
      AND u.role IN ('ADMIN', 'STAFF')
    ORDER BY u.deleted_at IS NOT NULL, u.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_list_operators() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_operators() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_operators() TO authenticated;
