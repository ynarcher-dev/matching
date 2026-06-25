-- =============================================================================
-- 0004_booking_rpc.sql — 예약 신청/변경/취소/관리자 강제배정 RPC (단일 트랜잭션)
-- 출처: docs/db_schema.md 4.1~4.3, docs/page_startup_booking.md 2장,
--       docs/page_admin_event_detail.md 3.2
-- =============================================================================
-- 검증 항목: 행사 상태, 참가 등록, 동시간 중복(스타트업/전문가), 동일 전문가 중복,
--           최대 상담 횟수, 실제 적용 테이블 충돌. 관리자 강제배정은 최대횟수만 우회.
-- =============================================================================

-- 슬롯의 실제 적용 테이블 해석 (table_id 우선, 없으면 전문가 기본 테이블)
CREATE OR REPLACE FUNCTION public.effective_table_id(p_slot public.matching_slots)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT COALESCE(
        p_slot.table_id,
        (SELECT ep.default_table_id FROM public.event_participants ep
         WHERE ep.event_id = p_slot.event_id AND ep.user_id = p_slot.expert_id)
    );
$$;

-- 슬롯 배정 유효성 검증(위반 시 EXCEPTION). p_bypass_max=TRUE 면 최대횟수만 우회.
CREATE OR REPLACE FUNCTION public._validate_slot_assignment(
    p_slot public.matching_slots,
    p_startup_id UUID,
    p_bypass_max BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_max INT;
    v_count INT;
    v_eff_table UUID := public.effective_table_id(p_slot);
BEGIN
    -- 참가 등록 확인 (스타트업)
    IF NOT EXISTS (
        SELECT 1 FROM public.event_participants ep
        WHERE ep.event_id = p_slot.event_id AND ep.user_id = p_startup_id
          AND ep.participant_type = 'STARTUP'
    ) THEN
        RAISE EXCEPTION '해당 스타트업은 이 행사의 참가자가 아닙니다.';
    END IF;

    -- 동시간 중복 (스타트업) — 타 행사 포함, 취소 제외
    IF EXISTS (
        SELECT 1 FROM public.matching_slots s
        WHERE s.startup_id = p_startup_id
          AND s.id <> p_slot.id
          AND s.session_status <> 'CANCELLED'
          AND s.start_time < p_slot.end_time AND s.end_time > p_slot.start_time
    ) THEN
        RAISE EXCEPTION '해당 스타트업은 이미 동일 시간대 다른 전문가와 매칭이 예약되어 있습니다.';
    END IF;

    -- 동시간 중복 (전문가)
    IF EXISTS (
        SELECT 1 FROM public.matching_slots s
        WHERE s.expert_id = p_slot.expert_id
          AND s.id <> p_slot.id
          AND s.startup_id IS NOT NULL
          AND s.session_status <> 'CANCELLED'
          AND s.start_time < p_slot.end_time AND s.end_time > p_slot.start_time
    ) THEN
        RAISE EXCEPTION '해당 전문가는 이미 동일 시간대에 다른 상담이 예약되어 있습니다.';
    END IF;

    -- 동일 전문가 중복 예약 (같은 행사 내)
    IF EXISTS (
        SELECT 1 FROM public.matching_slots s
        WHERE s.event_id = p_slot.event_id
          AND s.expert_id = p_slot.expert_id
          AND s.startup_id = p_startup_id
          AND s.id <> p_slot.id
          AND s.session_status <> 'CANCELLED'
    ) THEN
        RAISE EXCEPTION '한 행사에서 동일 전문가와 두 번 이상 예약할 수 없습니다.';
    END IF;

    -- 실제 적용 테이블 충돌 (관리자도 우회 불가)
    IF v_eff_table IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.matching_slots s
        WHERE s.event_id = p_slot.event_id
          AND s.id <> p_slot.id
          AND s.startup_id IS NOT NULL
          AND s.session_status <> 'CANCELLED'
          AND public.effective_table_id(s) = v_eff_table
          AND s.start_time < p_slot.end_time AND s.end_time > p_slot.start_time
    ) THEN
        RAISE EXCEPTION '해당 시간대에 같은 테이블이 이미 사용 중입니다.';
    END IF;

    -- 최대 상담 횟수 (관리자 강제배정만 우회)
    IF NOT p_bypass_max THEN
        SELECT max_sessions_per_startup INTO v_max FROM public.events WHERE id = p_slot.event_id;
        SELECT count(*) INTO v_count FROM public.matching_slots s
        WHERE s.event_id = p_slot.event_id
          AND s.startup_id = p_startup_id
          AND s.id <> p_slot.id
          AND s.session_status <> 'CANCELLED';
        IF v_count >= v_max THEN
            RAISE EXCEPTION '예약 한도 초과: 행사별 최대 %회까지만 예약할 수 있습니다.', v_max;
        END IF;
    END IF;
END;
$$;

-- 슬롯 정보 JSONB 스냅샷 (이력 기록용)
CREATE OR REPLACE FUNCTION public._slot_snapshot(p_slot public.matching_slots)
RETURNS JSONB
LANGUAGE sql IMMUTABLE
AS $$
    SELECT jsonb_build_object(
        'slot_id', p_slot.id, 'event_id', p_slot.event_id,
        'expert_id', p_slot.expert_id, 'startup_id', p_slot.startup_id,
        'start_time', p_slot.start_time, 'end_time', p_slot.end_time,
        'table_id', p_slot.table_id, 'booking_type', p_slot.booking_type
    );
$$;

-- -----------------------------------------------------------------------------
-- 1. 스타트업 예약 신청 (BOOKING 단계, 본인)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.book_slot(p_slot_id UUID)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_role TEXT := public.current_app_role();
    v_slot public.matching_slots%ROWTYPE;
    v_status TEXT;
BEGIN
    IF v_role <> 'STARTUP' THEN
        RAISE EXCEPTION '예약 신청은 스타트업만 가능합니다.';
    END IF;

    -- 슬롯 잠금(동시성 제어)
    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id FOR UPDATE;
    IF v_slot.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;
    IF v_slot.startup_id IS NOT NULL THEN RAISE EXCEPTION '이미 예약된 슬롯입니다.'; END IF;

    SELECT status INTO v_status FROM public.events WHERE id = v_slot.event_id;
    IF v_status <> 'BOOKING' THEN
        RAISE EXCEPTION '예약은 예약(BOOKING) 단계에서만 가능합니다.';
    END IF;

    PERFORM public._validate_slot_assignment(v_slot, v_uid, FALSE);

    UPDATE public.matching_slots
    SET startup_id = v_uid, booking_type = 'MANUAL'
    WHERE id = p_slot_id;

    INSERT INTO public.booking_history (matching_slot_id, action_type, actor_id, startup_id, expert_id, new_slot_info)
    VALUES (p_slot_id, 'CREATED', v_uid, v_uid, v_slot.expert_id,
            public._slot_snapshot((SELECT s FROM public.matching_slots s WHERE s.id = p_slot_id)));

    RETURN p_slot_id;
END;
$$;
REVOKE ALL ON FUNCTION public.book_slot(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.book_slot(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. 예약 변경 (기존 해제 + 신규 예약, 실패 시 전체 롤백)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_booking(p_from_slot_id UUID, p_to_slot_id UUID)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_from public.matching_slots%ROWTYPE;
    v_to public.matching_slots%ROWTYPE;
    v_status TEXT;
    v_self_ok BOOLEAN;
BEGIN
    IF public.current_app_role() <> 'STARTUP' THEN
        RAISE EXCEPTION '예약 변경은 스타트업만 가능합니다.';
    END IF;

    -- 데드락 방지를 위해 두 슬롯을 id 순으로 잠근다.
    PERFORM 1 FROM public.matching_slots WHERE id IN (p_from_slot_id, p_to_slot_id)
    ORDER BY id FOR UPDATE;

    SELECT * INTO v_from FROM public.matching_slots WHERE id = p_from_slot_id;
    SELECT * INTO v_to FROM public.matching_slots WHERE id = p_to_slot_id;
    IF v_from.id IS NULL OR v_to.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;
    IF v_from.startup_id <> v_uid THEN RAISE EXCEPTION '본인 예약만 변경할 수 있습니다.'; END IF;
    IF v_to.startup_id IS NOT NULL THEN RAISE EXCEPTION '이미 예약된 슬롯입니다.'; END IF;

    -- BOOKING 기본 허용. 자율 예약 토글 ON 이면 ALLOCATION/PROGRESS 에서도 본인 변경 허용.
    SELECT status, allow_startup_self_booking INTO v_status, v_self_ok
    FROM public.events WHERE id = v_to.event_id;
    IF NOT (v_status = 'BOOKING' OR (v_self_ok AND v_status IN ('ALLOCATION', 'PROGRESS'))) THEN
        RAISE EXCEPTION '현재 행사 단계(%)에서는 예약을 변경할 수 없습니다.', v_status;
    END IF;

    -- 기존 슬롯 해제 후 검증(자기 자신과의 충돌 방지)
    UPDATE public.matching_slots SET startup_id = NULL, booking_type = 'NONE' WHERE id = p_from_slot_id;
    PERFORM public._validate_slot_assignment(v_to, v_uid, FALSE);
    UPDATE public.matching_slots SET startup_id = v_uid, booking_type = 'MANUAL' WHERE id = p_to_slot_id;

    INSERT INTO public.booking_history (matching_slot_id, action_type, actor_id, startup_id, expert_id, previous_slot_info, new_slot_info)
    VALUES (p_to_slot_id, 'CHANGED', v_uid, v_uid, v_to.expert_id,
            public._slot_snapshot(v_from),
            public._slot_snapshot((SELECT s FROM public.matching_slots s WHERE s.id = p_to_slot_id)));

    RETURN p_to_slot_id;
END;
$$;
REVOKE ALL ON FUNCTION public.change_booking(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_booking(UUID, UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. 예약 취소 (스타트업 본인) — 슬롯 즉시 공개
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_booking(p_slot_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_slot public.matching_slots%ROWTYPE;
    v_status TEXT;
    v_self_ok BOOLEAN;
BEGIN
    IF public.current_app_role() <> 'STARTUP' THEN
        RAISE EXCEPTION '예약 취소는 스타트업만 가능합니다.';
    END IF;

    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id FOR UPDATE;
    IF v_slot.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;
    IF v_slot.startup_id <> v_uid THEN RAISE EXCEPTION '본인 예약만 취소할 수 있습니다.'; END IF;

    -- BOOKING 기본 허용. 자율 예약 토글 ON 이면 ALLOCATION/PROGRESS 에서도 본인 취소 허용.
    SELECT status, allow_startup_self_booking INTO v_status, v_self_ok
    FROM public.events WHERE id = v_slot.event_id;
    IF NOT (v_status = 'BOOKING' OR (v_self_ok AND v_status IN ('ALLOCATION', 'PROGRESS'))) THEN
        RAISE EXCEPTION '현재 행사 단계(%)에서는 예약을 취소할 수 없습니다.', v_status;
    END IF;

    UPDATE public.matching_slots SET startup_id = NULL, booking_type = 'NONE' WHERE id = p_slot_id;

    INSERT INTO public.booking_history (matching_slot_id, action_type, actor_id, startup_id, expert_id, previous_slot_info, reason)
    VALUES (p_slot_id, 'CANCELLED', v_uid, v_uid, v_slot.expert_id, public._slot_snapshot(v_slot), p_reason);

    RETURN p_slot_id;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_booking(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_booking(UUID, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. 관리자 강제 배정 (최대 횟수만 우회, 동시간/테이블 충돌은 우회 불가)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_force_assign(p_slot_id UUID, p_startup_id UUID, p_reason TEXT)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_slot public.matching_slots%ROWTYPE;
    v_prev JSONB;
BEGIN
    IF public.current_app_role() <> 'ADMIN' THEN
        RAISE EXCEPTION '강제 배정은 관리자만 가능합니다.';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
        RAISE EXCEPTION '강제 배정 사유는 필수입니다.';
    END IF;

    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id FOR UPDATE;
    IF v_slot.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;
    v_prev := public._slot_snapshot(v_slot);

    -- 기존 점유 해제 후 강제 배정 검증(최대횟수 우회)
    IF v_slot.startup_id IS NOT NULL THEN
        UPDATE public.matching_slots SET startup_id = NULL, booking_type = 'NONE' WHERE id = p_slot_id;
        SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id;
    END IF;

    PERFORM public._validate_slot_assignment(v_slot, p_startup_id, TRUE);

    UPDATE public.matching_slots
    SET startup_id = p_startup_id, booking_type = 'ADMIN_FORCE'
    WHERE id = p_slot_id;

    INSERT INTO public.booking_history (matching_slot_id, action_type, actor_id, startup_id, expert_id, previous_slot_info, new_slot_info, reason)
    VALUES (p_slot_id, 'CHANGED', v_uid, p_startup_id, v_slot.expert_id, v_prev,
            public._slot_snapshot((SELECT s FROM public.matching_slots s WHERE s.id = p_slot_id)), p_reason);

    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, old_values, new_values, reason)
    VALUES (v_uid, 'FORCE_ASSIGN', 'matching_slots', p_slot_id, v_prev,
            public._slot_snapshot((SELECT s FROM public.matching_slots s WHERE s.id = p_slot_id)), p_reason);

    RETURN p_slot_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_force_assign(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_force_assign(UUID, UUID, TEXT) TO authenticated;
