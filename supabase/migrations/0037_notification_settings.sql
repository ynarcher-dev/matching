-- =============================================================================
-- 0037_notification_settings.sql — 알림 정책 설정 (Phase 7 슬라이스 2)
-- 출처: docs/page_admin_notification_settings.md, docs/event_notification_api_plan.md
-- =============================================================================
-- 설계 원칙:
--   * 전역 dispatch_enabled = OFF 가 기본값 (무료 운영 모드).
--   * 행사별 정책 기본값 = NONE (발송 안 함).
--   * _enqueue_notification 에 게이트 추가:
--     정책 NONE 이거나 이벤트 토글 OFF 면 PENDING 로그 자체를 생성하지 않는다.
--   * API 키/시크릿은 DB 저장 않고 Edge Function 환경변수로만 관리.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 전역 알림 설정 (싱글턴 행, id=1 고정)
-- -----------------------------------------------------------------------------
CREATE TABLE public.notification_settings (
    id          SMALLINT PRIMARY KEY DEFAULT 1
                    CONSTRAINT notification_settings_singleton CHECK (id = 1),
    provider    TEXT NOT NULL DEFAULT 'MOCK'
                    CONSTRAINT notification_settings_provider_ck
                    CHECK (provider IN ('MOCK', 'SOLAPI')),
    dispatch_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    sender_phone TEXT,
    provider_configured_at TIMESTAMPTZ,
    last_tested_at TIMESTAMPTZ,
    last_test_status TEXT
                    CONSTRAINT notification_settings_test_status_ck
                    CHECK (last_test_status IN ('SUCCESS', 'FAILED')),
    updated_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 싱글턴 기본 행 삽입
INSERT INTO public.notification_settings (id) VALUES (1);

-- -----------------------------------------------------------------------------
-- 2. 행사별 알림 설정
-- -----------------------------------------------------------------------------
CREATE TABLE public.event_notification_settings (
    event_id            UUID PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
    notification_policy TEXT NOT NULL DEFAULT 'NONE'
                            CONSTRAINT event_notif_policy_ck
                            CHECK (notification_policy IN ('NONE', 'ALIMTALK', 'SMS', 'ALIMTALK_SMS')),
    template_set_id     TEXT,
    send_booking_open       BOOLEAN NOT NULL DEFAULT FALSE,
    send_booking_created    BOOLEAN NOT NULL DEFAULT FALSE,
    send_booking_changed    BOOLEAN NOT NULL DEFAULT FALSE,
    send_booking_cancelled  BOOLEAN NOT NULL DEFAULT FALSE,
    send_unbooked_reminder  BOOLEAN NOT NULL DEFAULT FALSE,
    send_event_reminder     BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 3. RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_notification_settings ENABLE ROW LEVEL SECURITY;

-- 전역 설정: ADMIN만 조회·수정
CREATE POLICY notif_settings_select_admin ON public.notification_settings
    FOR SELECT TO authenticated
    USING (public.current_app_role() = 'ADMIN');

CREATE POLICY notif_settings_update_admin ON public.notification_settings
    FOR UPDATE TO authenticated
    USING  (public.current_app_role() = 'ADMIN')
    WITH CHECK (public.current_app_role() = 'ADMIN');

-- 행사별 설정: ADMIN만 CRUD
CREATE POLICY event_notif_settings_select_admin ON public.event_notification_settings
    FOR SELECT TO authenticated
    USING (public.current_app_role() = 'ADMIN');

CREATE POLICY event_notif_settings_insert_admin ON public.event_notification_settings
    FOR INSERT TO authenticated
    WITH CHECK (public.current_app_role() = 'ADMIN');

CREATE POLICY event_notif_settings_update_admin ON public.event_notification_settings
    FOR UPDATE TO authenticated
    USING  (public.current_app_role() = 'ADMIN')
    WITH CHECK (public.current_app_role() = 'ADMIN');

-- anon 접근 차단
REVOKE ALL ON TABLE public.notification_settings FROM anon;
REVOKE ALL ON TABLE public.event_notification_settings FROM anon;

-- -----------------------------------------------------------------------------
-- 4. _enqueue_notification 업데이트 — 행사별 정책 게이트 추가
--    정책 = NONE 이거나 이벤트 타입 토글 OFF 면 PENDING 로그를 생성하지 않는다.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._enqueue_notification(
    p_event_id UUID,
    p_receiver_id UUID,
    p_type TEXT,
    p_idempotency_key TEXT,
    p_content TEXT
)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_phone       TEXT;
    v_email       TEXT;
    v_channel     TEXT;
    v_dest        TEXT;
    v_policy      TEXT;
    v_send_flag   BOOLEAN;
BEGIN
    IF p_receiver_id IS NULL OR p_event_id IS NULL THEN
        RETURN;
    END IF;

    -- 행사별 알림 정책 게이트 --------------------------------------------------
    SELECT
        ens.notification_policy,
        CASE p_type
            WHEN 'BOOKING_CREATED'    THEN ens.send_booking_created
            WHEN 'BOOKING_CHANGED'    THEN ens.send_booking_changed
            WHEN 'BOOKING_CANCELLED'  THEN ens.send_booking_cancelled
            WHEN 'EVENT_BOOKING_OPEN' THEN ens.send_booking_open
            ELSE FALSE
        END
    INTO v_policy, v_send_flag
    FROM public.event_notification_settings ens
    WHERE ens.event_id = p_event_id;

    -- 설정 행 없음 또는 정책 = NONE → 적재 안 함
    IF NOT FOUND OR v_policy = 'NONE' THEN
        RETURN;
    END IF;

    -- 이벤트 타입 토글 OFF → 적재 안 함
    IF NOT coalesce(v_send_flag, FALSE) THEN
        RETURN;
    END IF;
    -- -------------------------------------------------------------------------

    SELECT phone_number, email INTO v_phone, v_email
    FROM public.users WHERE id = p_receiver_id AND deleted_at IS NULL;

    IF coalesce(btrim(v_phone), '') <> '' THEN
        v_channel := 'ALIMTALK';
        v_dest    := btrim(v_phone);
    ELSIF coalesce(btrim(v_email), '') <> '' THEN
        v_channel := 'EMAIL';
        v_dest    := btrim(v_email);
    ELSE
        RETURN;  -- 발송 대상 연락처 없음
    END IF;

    INSERT INTO public.notification_logs (
        idempotency_key, event_id, receiver_id, notification_type,
        channel, destination, content, status
    )
    VALUES (
        p_idempotency_key, p_event_id, p_receiver_id, p_type,
        v_channel, v_dest, p_content, 'PENDING'
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public._enqueue_notification(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._enqueue_notification(UUID, UUID, TEXT, TEXT, TEXT) FROM anon, authenticated;
