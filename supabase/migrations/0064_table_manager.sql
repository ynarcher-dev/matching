-- =============================================================================
-- 0064_table_manager.sql — 테이블 담당자(현장 관리 스태프) 배정 (ideation 후속)
-- =============================================================================
-- 배경: 진행 타임그리드의 1열(테이블·전문가)에서 그 테이블을 현장에서 관리하는
--   담당자(행사 배정 오퍼레이터)를 바로 지정하고 싶다. 기존 '담당 전문가'(상담 진행자,
--   event_participants.default_table_id)와는 별개로, 사진 촬영·노쇼 대응 등 현장 운영을
--   책임지는 사람이다.
--
-- 설계:
--   - event_tables 에 manager_user_id 를 추가한다(테이블 단위 1명, ON DELETE SET NULL).
--   - 담당자 풀 = 해당 행사에 STAFF+ 로 배정된 오퍼레이터(event_operator_roles, revoked 아님).
--   - 지정/해제는 set_table_manager RPC 로 하고 can_manage_event(OWNER/MANAGER) 가드를 둔다
--     ('담당 전문가' 지정과 같은 관리 레벨). 변경은 audit_logs 에 남긴다.
--   - NOTE(A안, ideation 후속 결정): 담당자 목록 조회는 프론트에서 useEventOperators 를
--     쓰는데 현재 event_operator_roles SELECT RLS 가 최고관리자 기준이라, 일반 MANAGER 는
--     목록이 비어 보일 수 있다. 우선 최고관리자/OWNER 시나리오로 두고, 필요 시 별도
--     마이그레이션에서 SELECT RLS 를 can_manage_event 까지 확장한다.
-- =============================================================================

ALTER TABLE public.event_tables
    ADD COLUMN IF NOT EXISTS manager_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.event_tables.manager_user_id IS
    '테이블 현장 담당자(행사 배정 오퍼레이터 user_id). 담당 전문가(상담 진행자)와 별개.';

-- -----------------------------------------------------------------------------
-- set_table_manager: 테이블 담당자 지정/해제(p_user_id = NULL 이면 해제)
--   - 권한: can_manage_event(OWNER/MANAGER) — 담당 전문가 지정과 같은 관리 레벨.
--   - p_user_id 는 해당 행사에 STAFF+ 로 배정된(revoked 아님) 오퍼레이터여야 한다.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_table_manager(p_table_id UUID, p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_event_id UUID;
    v_old UUID;
BEGIN
    SELECT event_id, manager_user_id INTO v_event_id, v_old
    FROM public.event_tables WHERE id = p_table_id FOR UPDATE;
    IF v_event_id IS NULL THEN RAISE EXCEPTION '테이블을 찾을 수 없습니다.'; END IF;

    IF NOT public.can_manage_event(v_event_id) THEN
        RAISE EXCEPTION '테이블 담당자 지정은 해당 행사 관리 권한자만 가능합니다.';
    END IF;

    -- 지정(해제가 아니면) 시 담당자가 이 행사의 STAFF+ 오퍼레이터인지 검증.
    IF p_user_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.event_operator_roles r
            WHERE r.event_id = v_event_id
              AND r.user_id = p_user_id
              AND r.revoked_at IS NULL
              AND r.permission IN ('OWNER', 'MANAGER', 'STAFF')
        ) THEN
            RAISE EXCEPTION '담당자는 이 행사에 배정된 운영자(스태프 이상)여야 합니다.';
        END IF;
    END IF;

    UPDATE public.event_tables SET manager_user_id = p_user_id WHERE id = p_table_id;

    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, old_values, new_values)
    VALUES (
        v_uid, 'SET_TABLE_MANAGER', 'event_tables', p_table_id,
        jsonb_build_object('manager_user_id', v_old),
        jsonb_build_object('manager_user_id', p_user_id)
    );

    RETURN p_table_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_table_manager(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_table_manager(UUID, UUID) TO authenticated;
