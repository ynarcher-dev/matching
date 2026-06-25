-- =============================================================================
-- 0006_status_cron.sql — 행사 상태 자동 전환(1분 Cron) + 최고관리자 수동 Override
-- 출처: docs/db_schema.md 4.4, docs/page_admin_event_list.md 2.2
-- =============================================================================
-- 전이 순서: DRAFT → BOOKING → ALLOCATION → PROGRESS → FINISHED (전진만)
--   * status_override = TRUE 인 행사는 Cron 이 건드리지 않는다.
--   * CANCELLED/이미 FINISHED 는 제외.
-- =============================================================================

-- 상태 순서 랭크 (전진 전용 비교)
CREATE OR REPLACE FUNCTION public._status_rank(p_status TEXT)
RETURNS INT
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE p_status
        WHEN 'DRAFT' THEN 0
        WHEN 'BOOKING' THEN 1
        WHEN 'ALLOCATION' THEN 2
        WHEN 'PROGRESS' THEN 3
        WHEN 'FINISHED' THEN 4
        ELSE -1  -- CANCELLED 등
    END;
$$;

-- 일정으로부터 도출되는 목표 상태
CREATE OR REPLACE FUNCTION public._derive_event_status(e public.events)
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
    SELECT CASE
        WHEN now() >= e.event_end THEN 'FINISHED'
        WHEN now() >= e.event_start THEN 'PROGRESS'
        WHEN now() >= e.booking_end THEN 'ALLOCATION'
        WHEN now() >= e.booking_start THEN 'BOOKING'
        ELSE 'DRAFT'
    END;
$$;

-- Cron 본체: 오버라이드/취소 제외, 전진 전이만 반영
CREATE OR REPLACE FUNCTION public.transition_event_statuses()
RETURNS INT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_count INT := 0;
    e public.events%ROWTYPE;
    v_target TEXT;
BEGIN
    FOR e IN
        SELECT * FROM public.events
        WHERE deleted_at IS NULL
          AND status_override = FALSE
          AND status NOT IN ('FINISHED', 'CANCELLED')
        FOR UPDATE
    LOOP
        v_target := public._derive_event_status(e);
        IF public._status_rank(v_target) > public._status_rank(e.status) THEN
            UPDATE public.events SET status = v_target WHERE id = e.id;
            v_count := v_count + 1;
        END IF;
    END LOOP;
    RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.transition_event_statuses() FROM PUBLIC;
-- ※ Supabase 기본권한(anon/authenticated EXECUTE)을 명시 회수한다. cron 은 소유자(postgres)
--   권한으로 실행되므로 영향 없음. 클라이언트가 상태 전이를 임의 호출하는 것을 차단한다.
REVOKE EXECUTE ON FUNCTION public.transition_event_statuses() FROM anon, authenticated;

-- pg_cron 1분 주기 등록 (Supabase: postgres DB 에서 1회 실행)
-- 주의: 마이그레이션 재실행 안전성을 위해 기존 잡을 먼저 해제한다.
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'event-status-tick') THEN
        PERFORM cron.unschedule('event-status-tick');
    END IF;
END;
$$;
SELECT cron.schedule('event-status-tick', '* * * * *', $$ SELECT public.transition_event_statuses(); $$);

-- -----------------------------------------------------------------------------
-- 최고관리자 수동 상태 Override (사유 필수 + 감사 로그)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.override_event_status(p_event_id UUID, p_status TEXT, p_reason TEXT)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_event public.events%ROWTYPE;
    v_has_completed BOOLEAN;
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION '상태 강제 변경은 최고 관리자만 가능합니다.';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
        RAISE EXCEPTION '상태 강제 변경 사유는 필수입니다.';
    END IF;
    IF p_status NOT IN ('DRAFT', 'BOOKING', 'ALLOCATION', 'PROGRESS', 'FINISHED', 'CANCELLED') THEN
        RAISE EXCEPTION '유효하지 않은 상태값입니다: %', p_status;
    END IF;

    SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
    IF v_event.id IS NULL THEN RAISE EXCEPTION '행사를 찾을 수 없습니다.'; END IF;

    -- 완료된 상담일지가 있으면 DRAFT/BOOKING 으로 되돌릴 수 없다.
    IF p_status IN ('DRAFT', 'BOOKING') THEN
        SELECT EXISTS (
            SELECT 1 FROM public.counseling_logs cl
            JOIN public.matching_slots s ON s.id = cl.matching_slot_id
            WHERE s.event_id = p_event_id
        ) INTO v_has_completed;
        IF v_has_completed THEN
            RAISE EXCEPTION '완료된 상담일지가 있어 DRAFT/BOOKING 으로 되돌릴 수 없습니다.';
        END IF;
    END IF;

    UPDATE public.events SET
        status = p_status,
        status_override = TRUE,
        status_override_reason = p_reason,
        status_overridden_by = v_uid,
        status_overridden_at = now()
    WHERE id = p_event_id;

    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, old_values, new_values, reason)
    VALUES (v_uid, 'OVERRIDE_EVENT_STATUS', 'events', p_event_id,
        jsonb_build_object('status', v_event.status, 'status_override', v_event.status_override),
        jsonb_build_object('status', p_status, 'status_override', TRUE), p_reason);

    RETURN p_event_id;
END;
$$;
REVOKE ALL ON FUNCTION public.override_event_status(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.override_event_status(UUID, TEXT, TEXT) TO authenticated;

-- 자동 전환 재개 (Override 해제)
CREATE OR REPLACE FUNCTION public.clear_event_status_override(p_event_id UUID, p_reason TEXT)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_event public.events%ROWTYPE;
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION '상태 고정 해제는 최고 관리자만 가능합니다.';
    END IF;
    SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
    IF v_event.id IS NULL THEN RAISE EXCEPTION '행사를 찾을 수 없습니다.'; END IF;

    UPDATE public.events SET
        status_override = FALSE,
        status_override_reason = NULL,
        status_overridden_by = NULL,
        status_overridden_at = NULL
    WHERE id = p_event_id;

    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, old_values, new_values, reason)
    VALUES (v_uid, 'CLEAR_STATUS_OVERRIDE', 'events', p_event_id,
        jsonb_build_object('status_override', TRUE),
        jsonb_build_object('status_override', FALSE), p_reason);

    RETURN p_event_id;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_event_status_override(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_event_status_override(UUID, TEXT) TO authenticated;
