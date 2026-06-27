-- =============================================================================
-- 0040_operator_admin_rpc.sql — 운영자 계정/권한 관리 RPC (부가기능 슬라이스 C)
-- 출처: docs/page_admin_operator_permissions.md 4·6·9장
-- =============================================================================
-- 설계 원칙:
--   * 이 RPC 들은 service_role(Edge Function)만 호출한다 → anon/authenticated EXECUTE 회수.
--   * Edge 는 호출자 Supabase Auth JWT 로 최고관리자를 1차 검증하고, RPC 는 p_actor 의
--     최고관리자 여부를 DB 에서 2차 재검증한다(defense in depth, 명세 9장).
--   * 계정/권한 변경은 변경 + 감사 로그(audit_logs)를 한 트랜잭션으로 처리한다(명세 6장).
--   * Supabase Auth 사용자 생성/삭제 자체는 Edge(service role Auth API)가 담당하고,
--     본 RPC 는 public.users 행과 event_operator_roles, 감사 로그만 다룬다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. p_actor 최고관리자 재검증 헬퍼 (service_role 컨텍스트용 — auth.uid() 없음)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._assert_actor_super_admin(p_actor UUID)
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users
        WHERE id = p_actor
          AND role = 'ADMIN'
          AND is_super_admin = TRUE
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION '권한이 없습니다: 최고관리자만 수행할 수 있습니다.'
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._assert_actor_super_admin(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._assert_actor_super_admin(UUID) FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. 운영자 public.users 행 생성 (Auth 사용자는 Edge 가 선행 생성)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_operator(
    p_actor        UUID,
    p_auth_user_id UUID,
    p_email        TEXT,
    p_name         TEXT,
    p_role         TEXT,
    p_is_super     BOOLEAN,
    p_reason       TEXT
)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_id UUID;
BEGIN
    PERFORM public._assert_actor_super_admin(p_actor);

    IF coalesce(btrim(p_reason), '') = '' THEN
        RAISE EXCEPTION '사유 입력은 필수입니다.';
    END IF;
    IF p_role NOT IN ('ADMIN', 'STAFF') THEN
        RAISE EXCEPTION '운영자 역할은 ADMIN 또는 STAFF 만 허용합니다.';
    END IF;
    IF coalesce(p_is_super, FALSE) AND p_role <> 'ADMIN' THEN
        RAISE EXCEPTION '최고관리자 권한은 ADMIN 역할에만 부여할 수 있습니다.';
    END IF;

    INSERT INTO public.users (email, name, role, auth_user_id, is_super_admin)
    VALUES (btrim(p_email), btrim(p_name), p_role, p_auth_user_id, coalesce(p_is_super, FALSE))
    RETURNING id INTO v_id;

    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, new_values, reason)
    VALUES (p_actor, 'CREATE_OPERATOR', 'users', v_id,
            jsonb_build_object('email', btrim(p_email), 'role', p_role,
                               'is_super_admin', coalesce(p_is_super, FALSE)),
            p_reason);

    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_create_operator(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_create_operator(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT) FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. 운영자 수정 (이름/역할/최고관리자 플래그/비활성화)
--    p_active = FALSE → soft delete(deleted_at) → current_app_user_id() 차단으로 전 권한 상실.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_operator(
    p_actor    UUID,
    p_user_id  UUID,
    p_name     TEXT,
    p_role     TEXT,
    p_is_super BOOLEAN,
    p_active   BOOLEAN,
    p_reason   TEXT
)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_old public.users%ROWTYPE;
BEGIN
    PERFORM public._assert_actor_super_admin(p_actor);

    IF coalesce(btrim(p_reason), '') = '' THEN
        RAISE EXCEPTION '사유 입력은 필수입니다.';
    END IF;

    SELECT * INTO v_old FROM public.users WHERE id = p_user_id;
    IF v_old.id IS NULL THEN
        RAISE EXCEPTION '대상 운영자를 찾을 수 없습니다.';
    END IF;
    IF v_old.role NOT IN ('ADMIN', 'STAFF') THEN
        RAISE EXCEPTION '대상이 운영자(ADMIN/STAFF) 계정이 아닙니다.';
    END IF;
    IF p_role NOT IN ('ADMIN', 'STAFF') THEN
        RAISE EXCEPTION '운영자 역할은 ADMIN 또는 STAFF 만 허용합니다.';
    END IF;
    IF coalesce(p_is_super, FALSE) AND p_role <> 'ADMIN' THEN
        RAISE EXCEPTION '최고관리자 권한은 ADMIN 역할에만 부여할 수 있습니다.';
    END IF;
    -- 자기 자신의 최고관리자 박탈/비활성화 차단(자기 잠금 방지).
    IF p_user_id = p_actor AND (NOT coalesce(p_is_super, FALSE) OR NOT coalesce(p_active, TRUE)) THEN
        RAISE EXCEPTION '본인의 최고관리자 권한 해제 또는 비활성화는 할 수 없습니다.';
    END IF;

    UPDATE public.users SET
        name           = coalesce(btrim(p_name), name),
        role           = p_role,
        is_super_admin = coalesce(p_is_super, FALSE),
        deleted_at     = CASE WHEN coalesce(p_active, TRUE) THEN NULL ELSE coalesce(deleted_at, now()) END
    WHERE id = p_user_id;

    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, old_values, new_values, reason)
    VALUES (p_actor, 'UPDATE_OPERATOR', 'users', p_user_id,
            jsonb_build_object('name', v_old.name, 'role', v_old.role,
                               'is_super_admin', v_old.is_super_admin,
                               'active', v_old.deleted_at IS NULL),
            jsonb_build_object('name', coalesce(btrim(p_name), v_old.name), 'role', p_role,
                               'is_super_admin', coalesce(p_is_super, FALSE),
                               'active', coalesce(p_active, TRUE)),
            p_reason);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_operator(UUID, UUID, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_update_operator(UUID, UUID, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT) FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. 운영자 작업 감사 로그 단독 기록 (비밀번호 재설정/초대 발급 등 DB 변경 없는 액션)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_operator_audit(
    p_actor     UUID,
    p_action    TEXT,
    p_target_id UUID,
    p_reason    TEXT
)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public._assert_actor_super_admin(p_actor);
    IF coalesce(btrim(p_reason), '') = '' THEN
        RAISE EXCEPTION '사유 입력은 필수입니다.';
    END IF;
    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, reason)
    VALUES (p_actor, p_action, 'users', p_target_id, p_reason);
END;
$$;
REVOKE ALL ON FUNCTION public.record_operator_audit(UUID, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_operator_audit(UUID, TEXT, UUID, TEXT) FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. 행사 권한 부여 (등급 변경 = 기존 활성 회수 후 신규 부여)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_event_operator(
    p_actor      UUID,
    p_event_id   UUID,
    p_user_id    UUID,
    p_permission TEXT,
    p_reason     TEXT
)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_target_role TEXT;
    v_new_id UUID;
BEGIN
    PERFORM public._assert_actor_super_admin(p_actor);

    IF coalesce(btrim(p_reason), '') = '' THEN
        RAISE EXCEPTION '사유 입력은 필수입니다.';
    END IF;
    IF p_permission NOT IN ('OWNER', 'MANAGER', 'STAFF', 'VIEWER') THEN
        RAISE EXCEPTION '권한 등급이 올바르지 않습니다.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id AND deleted_at IS NULL) THEN
        RAISE EXCEPTION '대상 행사를 찾을 수 없습니다.';
    END IF;

    SELECT role INTO v_target_role FROM public.users WHERE id = p_user_id AND deleted_at IS NULL;
    IF v_target_role IS NULL THEN
        RAISE EXCEPTION '대상 운영자를 찾을 수 없습니다.';
    END IF;
    IF v_target_role NOT IN ('ADMIN', 'STAFF') THEN
        RAISE EXCEPTION '행사 권한은 운영자(ADMIN/STAFF)에게만 부여할 수 있습니다.';
    END IF;

    -- 기존 활성 권한 회수(등급 변경/재부여 멱등 처리)
    UPDATE public.event_operator_roles
       SET revoked_at = now(), revoked_by = p_actor
     WHERE event_id = p_event_id AND user_id = p_user_id AND revoked_at IS NULL;

    INSERT INTO public.event_operator_roles (event_id, user_id, permission, created_by)
    VALUES (p_event_id, p_user_id, p_permission, p_actor)
    RETURNING id INTO v_new_id;

    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, new_values, reason)
    VALUES (p_actor, 'GRANT_EVENT_OPERATOR', 'event_operator_roles', v_new_id,
            jsonb_build_object('event_id', p_event_id, 'user_id', p_user_id, 'permission', p_permission),
            p_reason);

    RETURN v_new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.grant_event_operator(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grant_event_operator(UUID, UUID, UUID, TEXT, TEXT) FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. 행사 권한 회수 (soft revoke)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_event_operator(
    p_actor    UUID,
    p_event_id UUID,
    p_user_id  UUID,
    p_reason   TEXT
)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_role_id UUID;
BEGIN
    PERFORM public._assert_actor_super_admin(p_actor);
    IF coalesce(btrim(p_reason), '') = '' THEN
        RAISE EXCEPTION '사유 입력은 필수입니다.';
    END IF;

    UPDATE public.event_operator_roles
       SET revoked_at = now(), revoked_by = p_actor
     WHERE event_id = p_event_id AND user_id = p_user_id AND revoked_at IS NULL
     RETURNING id INTO v_role_id;

    IF v_role_id IS NULL THEN
        RAISE EXCEPTION '회수할 활성 권한이 없습니다.';
    END IF;

    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, new_values, reason)
    VALUES (p_actor, 'REVOKE_EVENT_OPERATOR', 'event_operator_roles', v_role_id,
            jsonb_build_object('event_id', p_event_id, 'user_id', p_user_id),
            p_reason);
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_event_operator(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_event_operator(UUID, UUID, UUID, TEXT) FROM anon, authenticated;
