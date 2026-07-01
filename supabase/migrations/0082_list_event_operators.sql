-- =============================================================================
-- 0082_list_event_operators.sql — 행사 운영자 목록 조회 RPC (보안계획 A-11 / 감사 C-2)
-- 출처: docs/security_remediation_plan.md A-11, 0064_table_manager.sql NOTE(A안)
-- =============================================================================
-- 배경:
--   event_operator_roles 의 SELECT RLS(0039 event_operator_select)는 최고관리자
--   또는 "본인 권한 행"만 노출한다. 그래서 일반 MANAGER(비 최고관리자)는 자기가
--   관리하는 행사라도 배정된 운영자 "목록"을 볼 수 없다(본인 1행만 보임).
--   0064 의 테이블 현장 담당자 지정(set_table_manager)은 이 목록을 후보 풀로 쓰는데,
--   MANAGER 화면에서 풀이 비어 보이는 문제(0064 NOTE)가 있었다.
--
-- 조치(RLS 확대 없이):
--   RLS 를 넓히면 "본인 행만" 원칙이 깨지고 우회 표면이 커진다. 대신 호출자가 해당
--   행사의 관리권한(can_manage_event = 최고관리자 또는 OWNER/MANAGER)을 가질 때에만
--   그 행사의 활성 운영자 목록을 반환하는 SECURITY DEFINER RPC 를 추가한다.
--   RLS 는 그대로(본인 행만) 두고, 목록 조회는 이 RPC 로만 확장한다.
--
-- 권한 게이트:
--   WHERE 절에 can_manage_event(p_event_id) 를 두어, 관리권한이 없으면 전체가 FALSE
--   → 행 0건(권한 밖 행사는 빈 결과). 관리권한이 있으면 그 행사의 활성 운영자 전체.
--   최고관리자는 can_manage_event 가 항상 TRUE 이므로 기존 RLS 조회와 동일 결과.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.list_event_operators(p_event_id UUID)
RETURNS TABLE (
    id             UUID,
    user_id        UUID,
    permission     TEXT,
    created_at     TIMESTAMPTZ,
    operator_name  TEXT,
    operator_email TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT
        r.id,
        r.user_id,
        r.permission::text,
        r.created_at,
        u.name::text,
        u.email::text
    FROM public.event_operator_roles r
    LEFT JOIN public.users u ON u.id = r.user_id
    -- 관리권한이 없으면 상수 FALSE → 어떤 행도 통과 못 함(권한 밖 행사 = 빈 결과).
    WHERE public.can_manage_event(p_event_id)
      AND r.event_id = p_event_id
      AND r.revoked_at IS NULL
    ORDER BY u.name;
$$;

REVOKE ALL     ON FUNCTION public.list_event_operators(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_event_operators(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.list_event_operators(UUID) TO authenticated;
