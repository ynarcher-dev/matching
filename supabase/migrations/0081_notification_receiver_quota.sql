-- =============================================================================
-- 0081_notification_receiver_quota.sql — 알림 상태전이 루프 중복발송 가드 (보안 A-10 / 보완-05)
-- 근거: docs/security_remediation_plan.md A-10, docs/security_service_audit_supplement.md [보완-05]
-- =============================================================================
-- 배경(현행 추적):
--   * _enqueue_notification 의 최신 정의는 0038(전역 게이트 + 정책별 채널)이다.
--     0037→0038 순으로 CREATE OR REPLACE, 0065 는 UI 토글 컬럼만 추가(함수 미변경).
--   * EVENT_BOOKING_OPEN 은 이미 멱등키 'event_open:{event_id}:{user_id}' 가 (행사,수신자)당
--     고정이라, idempotency_key UNIQUE + ON CONFLICT DO NOTHING 으로 DRAFT↔BOOKING 을
--     아무리 반복 토글해도 수신자당 1행만 적재된다(= 계획서 완료기준 충족).
--   * 다만 _notify_booking_event 는 'booking:{booking_history.id}' 로 액션 행마다 새 키를
--     쓰므로, 예약 생성/취소 루프(스크립트 오작동/악의) 시 한 수신자에게 무제한 적재될 수 있다.
--     향후 비멱등 타입이 추가돼도 같은 위험이 있다.
--
-- 이 마이그레이션:
--   * _enqueue_notification 에 "수신자별 유량 가드(quota)"를 추가한다.
--     동일 (행사, 수신자) 로 최근 1시간 내 이미 적재된 알림이 임계값 이상이면 새 적재를 skip.
--     → 상태전이 루프/예약 루프로 인한 대량 중복 발송(요금 테러)을 적재 단에서 차단.
--   * 임계값(30/시간·수신자)은 정상 운영에서 한 수신자가 받는 알림 수(EVENT_BOOKING_OPEN 1회 +
--     본인 예약 액션 소수)를 훨씬 상회하는 넉넉한 값이라, 정상 발송 UX 에는 영향이 없다.
--   * 카운트는 (행사, 수신자) 기준이므로 참가자 500명 행사에서 각 수신자 1건씩 적재하는
--     정상 대량 발송(EVENT_BOOKING_OPEN fan-out)은 수신자별 count=1 로 가드에 걸리지 않는다.
--
-- 0038 대비 변경점은 "유량 가드 블록" 1개 추가뿐이며, 전역 게이트/정책 게이트/토글 게이트/
-- 채널 결정/INSERT 로직은 0038 을 그대로 유지한다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 유량 가드 카운트 가속용 인덱스
--    (event_id, receiver_id, created_at) — 수신자별 최근 발송 이력 count 지원.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notif_event_receiver_created
    ON public.notification_logs (event_id, receiver_id, created_at);

-- -----------------------------------------------------------------------------
-- 2. _enqueue_notification — 0038 정의 + 수신자별 유량 가드(quota)
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
    v_recent_cnt  INT;
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

    -- 수신자별 유량 가드(quota) — A-10 / 보완-05 -------------------------------
    -- 동일 (행사, 수신자) 로 최근 1시간 내 적재된 알림이 임계값 이상이면 새 적재 skip.
    -- 상태전이 루프(DRAFT↔BOOKING)/예약 생성·취소 루프로 인한 대량 중복 발송을 차단한다.
    -- 임계값 30 은 정상 운영에서 한 수신자가 1시간 내 받는 알림 수를 크게 상회한다.
    -- EVENT_BOOKING_OPEN 은 멱등키가 (행사,수신자)당 고정이라 반복 토글해도 count 가
    -- 늘지 않으므로, 이 가드는 주로 비멱등 타입(예약 액션 루프)의 백스톱으로 작동한다.
    SELECT count(*) INTO v_recent_cnt
    FROM public.notification_logs
    WHERE event_id = p_event_id
      AND receiver_id = p_receiver_id
      AND created_at >= now() - INTERVAL '1 hour';

    IF v_recent_cnt >= 30 THEN
        RAISE NOTICE '[notif] 수신자 유량 가드 발동 — event=% receiver=% recent=%',
            p_event_id, p_receiver_id, v_recent_cnt;
        RETURN;
    END IF;
    -- -------------------------------------------------------------------------

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
