-- =============================================================================
-- 0038_notification_dispatch_gate.sql — 전역 발송 게이트 + 정책별 채널 + 테스트 기록
-- 출처: docs/page_admin_notification_settings.md §2·§5, docs/event_notification_api_plan.md §6
-- =============================================================================
-- 0037 에서 행사별 정책(NONE/토글)을 _enqueue_notification 게이트에 반영했다.
-- 0038 은 다음을 추가한다:
--   1) 전역 notification_settings.dispatch_enabled = false 면 큐(PENDING 로그)를 만들지 않는다.
--      → "전역 OFF(무료 운영)면 발송 대상 큐를 만들지 않음"(§5.1 권장).
--   2) 채널을 행사 정책에 맞춰 결정한다(SMS 정책=SMS, 그 외=ALIMTALK; 휴대폰 없으면 EMAIL).
--   3) 관리자 테스트 발송 결과를 notification_settings 에 기록하는 RPC.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. _enqueue_notification — 전역 게이트 + 정책별 채널 결정
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
    v_global_on   BOOLEAN;
BEGIN
    IF p_receiver_id IS NULL OR p_event_id IS NULL THEN
        RETURN;
    END IF;

    -- 전역 발송 게이트 --------------------------------------------------------
    -- 전역 dispatch_enabled = false(무료 운영) 면 큐 자체를 만들지 않는다.
    SELECT dispatch_enabled INTO v_global_on
    FROM public.notification_settings WHERE id = 1;

    IF NOT coalesce(v_global_on, FALSE) THEN
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
        -- 정책이 SMS 단독이면 SMS, 그 외(ALIMTALK / ALIMTALK_SMS)는 ALIMTALK 를 1차 채널로.
        v_channel := CASE WHEN v_policy = 'SMS' THEN 'SMS' ELSE 'ALIMTALK' END;
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

-- -----------------------------------------------------------------------------
-- 2. 테스트 발송 결과 기록 RPC (Edge 워커 = service_role 전용)
--    notification-test Edge 가 실제 발송 시도 후 결과를 기록한다.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_notification_test(
    p_status TEXT,
    p_actor UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
    UPDATE public.notification_settings
    SET last_tested_at = now(),
        last_test_status = CASE WHEN p_status = 'SUCCESS' THEN 'SUCCESS' ELSE 'FAILED' END,
        updated_by = coalesce(p_actor, updated_by),
        updated_at = now()
    WHERE id = 1;
$$;
REVOKE ALL ON FUNCTION public.record_notification_test(TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_notification_test(TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_notification_test(TEXT, UUID) TO service_role;
