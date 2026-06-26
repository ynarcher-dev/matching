-- =============================================================================
-- 0034_notification_infra.sql — 알림 발송 인프라 (Phase 7 슬라이스 1)
-- 출처: docs/db_schema.md 2.15(notification_logs), docs/security_transactions.md 4장
-- =============================================================================
-- 설계 원칙(security_transactions.md 4장):
--   * 예약·상담 트랜잭션을 먼저 완료한 후 알림을 "비동기"로 처리한다.
--     → 트리거는 PENDING 로그 행만 적재(enqueue)하고, 실제 발송은 Cron→Edge 워커가 수행.
--   * (event, receiver) 조합의 idempotency_key 로 중복 발송을 방지한다.
--   * 실패 시 지수 백오프로 최대 3회 재시도하고 영구 실패(FAILED)는 관리자 화면에 표시.
--   * 초기 개발은 Mock 어댑터(notifier.ts), 운영은 Solapi 등 실어댑터로 교체.
--
-- notification_logs 는 0001 에서 생성됨(idempotency_key UNIQUE / status PENDING|SENT|FAILED /
--   retry_count 0..3 / next_retry_at). RLS 는 0003 notif_select_admin(ADMIN SELECT)만 존재.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 지수 백오프 간격 (재시도 횟수 → 다음 시도까지 대기)
--    retry_count 1 → 1분, 2 → 5분 (3회째 실패는 FAILED 로 종료하므로 사용 안 됨)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._notif_backoff(p_retry INT)
RETURNS INTERVAL
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE p_retry
        WHEN 1 THEN INTERVAL '1 minute'
        WHEN 2 THEN INTERVAL '5 minutes'
        ELSE INTERVAL '15 minutes'
    END;
$$;

-- -----------------------------------------------------------------------------
-- 2. enqueue 헬퍼 — 수신자의 연락 채널을 도출해 PENDING 로그를 멱등 적재
--    채널 우선순위: 휴대전화 있으면 ALIMTALK, 없으면 EMAIL. 둘 다 없으면 적재 안 함.
--    내부 전용(트리거에서만 호출). idempotency_key 충돌 시 DO NOTHING.
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
    v_phone TEXT;
    v_email TEXT;
    v_channel TEXT;
    v_dest TEXT;
BEGIN
    IF p_receiver_id IS NULL OR p_event_id IS NULL THEN
        RETURN;
    END IF;

    SELECT phone_number, email INTO v_phone, v_email
    FROM public.users WHERE id = p_receiver_id AND deleted_at IS NULL;

    IF coalesce(btrim(v_phone), '') <> '' THEN
        v_channel := 'ALIMTALK';
        v_dest := btrim(v_phone);
    ELSIF coalesce(btrim(v_email), '') <> '' THEN
        v_channel := 'EMAIL';
        v_dest := btrim(v_email);
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
-- 3. 알림 이벤트 훅 (트리거)
-- -----------------------------------------------------------------------------
-- 3.1 예약 생성/변경/취소 → 스타트업에게 알림 (booking_history INSERT 후)
CREATE OR REPLACE FUNCTION public._notify_booking_event()
RETURNS TRIGGER
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_event_id UUID;
    v_start TIMESTAMPTZ;
    v_title TEXT;
    v_tz TEXT;
    v_when TEXT;
    v_type TEXT;
    v_content TEXT;
BEGIN
    IF NEW.action_type NOT IN ('CREATED', 'CHANGED', 'CANCELLED') THEN
        RETURN NEW;
    END IF;
    IF NEW.startup_id IS NULL OR NEW.matching_slot_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT s.event_id, s.start_time, e.title, e.timezone
      INTO v_event_id, v_start, v_title, v_tz
    FROM public.matching_slots s
    JOIN public.events e ON e.id = s.event_id
    WHERE s.id = NEW.matching_slot_id;

    IF v_event_id IS NULL THEN
        RETURN NEW;
    END IF;

    v_when := to_char(v_start AT TIME ZONE coalesce(v_tz, 'Asia/Seoul'), 'MM/DD HH24:MI');
    v_type := 'BOOKING_' || NEW.action_type;
    v_content := CASE NEW.action_type
        WHEN 'CREATED' THEN format('[%s] 상담 예약이 확정되었습니다. 일시: %s', v_title, v_when)
        WHEN 'CHANGED' THEN format('[%s] 상담 예약 시간이 변경되었습니다. 변경된 일시: %s', v_title, v_when)
        WHEN 'CANCELLED' THEN format('[%s] 상담 예약이 취소되었습니다. (기존 일시: %s)', v_title, v_when)
    END;

    -- booking_history.id 는 행 1건당 고유 → 멱등키로 그대로 사용(같은 액션 중복 적재 방지).
    PERFORM public._enqueue_notification(
        v_event_id, NEW.startup_id, v_type, 'booking:' || NEW.id::text, v_content
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_booking ON public.booking_history;
CREATE TRIGGER trg_notify_booking
    AFTER INSERT ON public.booking_history
    FOR EACH ROW EXECUTE FUNCTION public._notify_booking_event();

-- 3.2 행사 상태가 BOOKING 으로 전환되면 참가 스타트업 전원에게 예약 시작 안내
CREATE OR REPLACE FUNCTION public._notify_event_status()
RETURNS TRIGGER
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    p RECORD;
    v_deadline TEXT;
    v_content TEXT;
BEGIN
    IF NOT (NEW.status = 'BOOKING' AND OLD.status IS DISTINCT FROM 'BOOKING') THEN
        RETURN NEW;
    END IF;

    v_deadline := to_char(NEW.booking_end AT TIME ZONE coalesce(NEW.timezone, 'Asia/Seoul'), 'MM/DD HH24:MI');
    v_content := format('[%s] 상담 예약이 시작되었습니다. 예약 마감: %s', NEW.title, v_deadline);

    FOR p IN
        SELECT user_id FROM public.event_participants
        WHERE event_id = NEW.id AND participant_type = 'STARTUP'
    LOOP
        PERFORM public._enqueue_notification(
            NEW.id, p.user_id, 'EVENT_BOOKING_OPEN',
            'event_open:' || NEW.id::text || ':' || p.user_id::text, v_content
        );
    END LOOP;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_event_status ON public.events;
CREATE TRIGGER trg_notify_event_status
    AFTER UPDATE OF status ON public.events
    FOR EACH ROW EXECUTE FUNCTION public._notify_event_status();

-- -----------------------------------------------------------------------------
-- 4. 디스패치 RPC (Edge 워커 = service_role 전용)
-- -----------------------------------------------------------------------------
-- 4.1 발송 대상(PENDING & 재시도 시각 도래) 을 가져오면서 가시성 타임아웃을 건다.
--     FOR UPDATE SKIP LOCKED + next_retry_at 를 2분 뒤로 밀어 동시 워커/크래시에 안전.
CREATE OR REPLACE FUNCTION public.claim_due_notifications(p_limit INT DEFAULT 50)
RETURNS SETOF public.notification_logs
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH due AS (
        SELECT id FROM public.notification_logs
        WHERE status = 'PENDING'
          AND (next_retry_at IS NULL OR next_retry_at <= now())
        ORDER BY created_at
        LIMIT greatest(1, least(p_limit, 200))
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.notification_logs n
    SET next_retry_at = now() + INTERVAL '2 minutes', updated_at = now()
    FROM due
    WHERE n.id = due.id
    RETURNING n.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_due_notifications(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_due_notifications(INT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_notifications(INT) TO service_role;

-- 4.2 발송 성공 처리
CREATE OR REPLACE FUNCTION public.mark_notification_sent(p_id UUID)
RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
    UPDATE public.notification_logs
    SET status = 'SENT', next_retry_at = NULL, error_message = NULL, updated_at = now()
    WHERE id = p_id;
$$;
REVOKE ALL ON FUNCTION public.mark_notification_sent(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_notification_sent(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_sent(UUID) TO service_role;

-- 4.3 발송 실패 처리 — retry_count 증가, 3회 도달 시 FAILED, 그 외 백오프 후 재시도 대기
CREATE OR REPLACE FUNCTION public.mark_notification_failed(p_id UUID, p_error TEXT)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_retry INT;
BEGIN
    UPDATE public.notification_logs
    SET retry_count = retry_count + 1,
        error_message = left(coalesce(p_error, ''), 1000),
        updated_at = now()
    WHERE id = p_id
    RETURNING retry_count INTO v_retry;

    IF v_retry IS NULL THEN
        RETURN;  -- 존재하지 않는 행
    END IF;

    IF v_retry >= 3 THEN
        UPDATE public.notification_logs
        SET status = 'FAILED', next_retry_at = NULL, updated_at = now()
        WHERE id = p_id;
    ELSE
        UPDATE public.notification_logs
        SET status = 'PENDING', next_retry_at = now() + public._notif_backoff(v_retry), updated_at = now()
        WHERE id = p_id;
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_notification_failed(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_notification_failed(UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_failed(UUID, TEXT) TO service_role;

-- -----------------------------------------------------------------------------
-- 5. 관리자 수동 재시도 (FAILED → PENDING 으로 초기화, 사유 감사)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retry_notification(p_id UUID)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
BEGIN
    IF public.current_app_role() <> 'ADMIN' THEN
        RAISE EXCEPTION '알림 재시도는 관리자만 가능합니다.';
    END IF;

    UPDATE public.notification_logs
    SET status = 'PENDING', retry_count = 0, next_retry_at = NULL,
        error_message = NULL, updated_at = now()
    WHERE id = p_id AND status = 'FAILED';

    IF NOT FOUND THEN
        RAISE EXCEPTION '재시도할 수 없는 알림입니다(영구 실패 상태만 재시도 가능).';
    END IF;

    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id)
    VALUES (v_uid, 'RETRY_NOTIFICATION', 'notification_logs', p_id);

    RETURN p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.retry_notification(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.retry_notification(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.retry_notification(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. 디스패치 Cron (1분) — Edge Function(notification-dispatch) 호출
-- -----------------------------------------------------------------------------
-- 발송 어댑터(Mock/Solapi)는 Deno Edge 에 있으므로 Cron 은 net.http_post 로 Edge 를 호출한다.
-- 호출에 필요한 함수 URL / 호출 시크릿은 Vault 시크릿(notif_dispatch_url, notif_dispatch_secret)
-- 에서 읽는다. 두 시크릿이 모두 설정된 경우에만 Cron 을 등록하고, 아니면 건너뛴다(마이그레이션 안전).
--   ※ 시크릿 미설정 시: 관리자 화면의 "지금 발송 처리" 또는 수동 Edge 호출로 디스패치할 수 있다.
DO $$
DECLARE
    v_url TEXT;
    v_secret TEXT;
BEGIN
    -- pg_net / vault 미가용 환경에서도 마이그레이션이 깨지지 않도록 방어.
    BEGIN
        SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'notif_dispatch_url';
        SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'notif_dispatch_secret';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[0034] vault 미가용 — 알림 디스패치 Cron 등록을 건너뜁니다.';
        RETURN;
    END;

    IF v_url IS NULL OR v_secret IS NULL THEN
        RAISE NOTICE '[0034] notif_dispatch_url/secret 미설정 — 알림 디스패치 Cron 등록을 건너뜁니다.';
        RETURN;
    END IF;

    CREATE EXTENSION IF NOT EXISTS pg_cron;
    CREATE EXTENSION IF NOT EXISTS pg_net;

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notification-dispatch-tick') THEN
        PERFORM cron.unschedule('notification-dispatch-tick');
    END IF;

    PERFORM cron.schedule(
        'notification-dispatch-tick', '* * * * *',
        format(
            $cron$ SELECT net.http_post(
                url := %L,
                headers := jsonb_build_object('Content-Type','application/json','x-dispatch-secret',%L),
                body := '{}'::jsonb
            ); $cron$,
            v_url, v_secret
        )
    );
    RAISE NOTICE '[0034] 알림 디스패치 Cron 등록 완료.';
END;
$$;
