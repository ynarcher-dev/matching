-- =============================================================================
-- 0039_event_operator_roles.sql — 운영자 행사별 권한 모델 (부가기능 슬라이스 A)
-- 출처: docs/page_admin_operator_permissions.md 2~3장, docs/security_transactions.md 2장
-- =============================================================================
-- 목적:
--   전역 ADMIN 권한 위에 "행사별 운영자 권한"을 얹기 위한 토대 테이블 + 헬퍼.
--   본 슬라이스(A)는 순수 추가(additive)다. 기존 RLS/RPC 의 전역 ADMIN 정책은
--   그대로 두며, 행사 범위 전환(기존 정책 교체)은 슬라이스 B 에서 수행한다.
--
-- 설계 원칙:
--   * 최고관리자(is_super_admin)는 항상 전체 행사 접근 — 헬퍼가 무조건 TRUE 반환.
--   * 권한 등급: OWNER > MANAGER > STAFF > VIEWER (행사 단위).
--   * soft revoke: revoked_at 으로 회수. 활성 권한은 (event_id, user_id) 유니크.
--   * 헬퍼는 0017 의 'NONE' 센티넬/NULL 안전 패턴을 유지(매핑 없는 호출자=거부).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 행사별 운영자 권한 테이블
-- -----------------------------------------------------------------------------
CREATE TABLE public.event_operator_roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    permission  TEXT NOT NULL
                    CONSTRAINT chk_event_operator_permission
                    CHECK (permission IN ('OWNER', 'MANAGER', 'STAFF', 'VIEWER')),
    created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMP WITH TIME ZONE,
    revoked_by  UUID REFERENCES public.users(id) ON DELETE SET NULL
);

-- 활성 권한은 (행사, 운영자) 당 1건만 — soft revoke 된 행은 제외해 재부여를 허용.
CREATE UNIQUE INDEX uniq_event_operator_active
    ON public.event_operator_roles (event_id, user_id)
    WHERE revoked_at IS NULL;

-- 헬퍼 조회 가속: 특정 사용자의 활성 권한 / 특정 행사의 활성 운영자.
CREATE INDEX idx_event_operator_user ON public.event_operator_roles (user_id)
    WHERE revoked_at IS NULL;
CREATE INDEX idx_event_operator_event ON public.event_operator_roles (event_id)
    WHERE revoked_at IS NULL;

-- -----------------------------------------------------------------------------
-- 2. 권한 헬퍼 (SECURITY DEFINER — 재귀 RLS 회피, 가드/정책 공용)
-- -----------------------------------------------------------------------------
-- 운영자 로그인 가능 역할(ADMIN) 여부. "전역 관리자"가 아니라 "운영자 계정"의 의미.
CREATE OR REPLACE FUNCTION public.is_operator_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT public.current_app_role() = 'ADMIN';
$$;

-- 최고관리자 또는 해당 행사의 활성 운영자(권한 무관) 여부.
CREATE OR REPLACE FUNCTION public.is_event_operator(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT public.is_super_admin() OR EXISTS (
        SELECT 1 FROM public.event_operator_roles r
        WHERE r.event_id = p_event_id
          AND r.user_id = public.current_app_user_id()
          AND r.revoked_at IS NULL
    );
$$;

-- 최고관리자 또는 OWNER/MANAGER (행사 설정/배정/배치/리포트 다운로드).
CREATE OR REPLACE FUNCTION public.can_manage_event(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT public.is_super_admin() OR EXISTS (
        SELECT 1 FROM public.event_operator_roles r
        WHERE r.event_id = p_event_id
          AND r.user_id = public.current_app_user_id()
          AND r.revoked_at IS NULL
          AND r.permission IN ('OWNER', 'MANAGER')
    );
$$;

-- 최고관리자 또는 OWNER/MANAGER/STAFF (현장 사진/출석 등 현장 기능).
CREATE OR REPLACE FUNCTION public.can_staff_event(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT public.is_super_admin() OR EXISTS (
        SELECT 1 FROM public.event_operator_roles r
        WHERE r.event_id = p_event_id
          AND r.user_id = public.current_app_user_id()
          AND r.revoked_at IS NULL
          AND r.permission IN ('OWNER', 'MANAGER', 'STAFF')
    );
$$;

-- 최고관리자 또는 모든 활성 행사 권한(VIEWER 이상) — 조회/리포트 확인.
CREATE OR REPLACE FUNCTION public.can_view_event(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT public.is_super_admin() OR EXISTS (
        SELECT 1 FROM public.event_operator_roles r
        WHERE r.event_id = p_event_id
          AND r.user_id = public.current_app_user_id()
          AND r.revoked_at IS NULL
    );
$$;

REVOKE ALL ON FUNCTION public.is_operator_admin()        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_event_operator(UUID)    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_event(UUID)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_staff_event(UUID)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_event(UUID)       FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_operator_admin()     TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_event_operator(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_event(UUID)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_staff_event(UUID)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_event(UUID)    TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. RLS — event_operator_roles
-- -----------------------------------------------------------------------------
-- 조회: 최고관리자 전체 / 운영자는 본인 권한 행만 확인 가능.
-- 쓰기(부여·회수)는 슬라이스 C 의 service_role Edge Function 으로 처리하므로
-- (RLS 우회) 여기서는 INSERT/UPDATE/DELETE 정책을 최고관리자에게만 직접 허용해
-- 둔다. 일반 운영자(OWNER 포함) 직접 쓰기는 정책 부재로 차단된다.
-- -----------------------------------------------------------------------------
ALTER TABLE public.event_operator_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY event_operator_select ON public.event_operator_roles
    FOR SELECT TO authenticated
    USING (
        public.is_super_admin()
        OR user_id = public.current_app_user_id()
    );

CREATE POLICY event_operator_insert_super ON public.event_operator_roles
    FOR INSERT TO authenticated
    WITH CHECK (public.is_super_admin());

CREATE POLICY event_operator_update_super ON public.event_operator_roles
    FOR UPDATE TO authenticated
    USING  (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

CREATE POLICY event_operator_delete_super ON public.event_operator_roles
    FOR DELETE TO authenticated
    USING (public.is_super_admin());

-- anon 직접 접근 차단(Supabase 기본 grant 보정).
REVOKE ALL ON TABLE public.event_operator_roles FROM anon;
