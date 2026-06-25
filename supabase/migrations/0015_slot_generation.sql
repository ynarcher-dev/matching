-- =============================================================================
-- 0015_slot_generation.sql — 시간표 예약 슬롯 자동 생성 / 빈 슬롯 초기화 RPC
-- 출처: docs/page_admin_event_detail.md §2.1(DRAFT 기초 매핑),
--       docs/page_admin_ai_allocation.md §1.2(잔여 슬롯 전제)
-- =============================================================================
-- 행사의 활성 전문가 참가자별로 동일한 시간 그리드(세션 길이·휴식·횟수)를 따라
-- 빈 슬롯(startup_id NULL, booking_type NONE, session_status WAITING)을 생성한다.
-- 예약/진행된 슬롯은 보존하며, 재생성 시 같은 전문가의 빈 슬롯만 교체한다. 관리자 전용.
-- table_id 는 지정하지 않는다 → effective_table_id(0004) 가 전문가 기본 테이블로 해석.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 슬롯 자동 생성 (전문가별 동일 그리드)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_event_slots(
    p_event_id UUID,
    p_start_time TIMESTAMPTZ,
    p_session_minutes INT,
    p_session_count INT,
    p_break_minutes INT DEFAULT 0,
    p_expert_ids UUID[] DEFAULT NULL,
    p_replace_unbooked BOOLEAN DEFAULT TRUE
)
RETURNS INT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_status TEXT;
    v_created INT := 0;
    v_expert RECORD;
    v_i INT;
    v_start TIMESTAMPTZ;
    v_end TIMESTAMPTZ;
    v_step INT;
BEGIN
    IF public.current_app_role() <> 'ADMIN' THEN
        RAISE EXCEPTION '슬롯 생성은 관리자만 가능합니다.';
    END IF;
    IF p_start_time IS NULL THEN
        RAISE EXCEPTION '시작 시각은 필수입니다.';
    END IF;
    IF p_session_minutes IS NULL OR p_session_minutes <= 0 OR p_session_minutes > 600 THEN
        RAISE EXCEPTION '세션 길이는 1~600분 사이여야 합니다.';
    END IF;
    IF p_session_count IS NULL OR p_session_count <= 0 OR p_session_count > 50 THEN
        RAISE EXCEPTION '세션 횟수는 1~50회 사이여야 합니다.';
    END IF;
    IF p_break_minutes IS NULL OR p_break_minutes < 0 OR p_break_minutes > 600 THEN
        RAISE EXCEPTION '휴식 시간은 0~600분 사이여야 합니다.';
    END IF;

    SELECT status INTO v_status FROM public.events WHERE id = p_event_id AND deleted_at IS NULL;
    IF v_status IS NULL THEN RAISE EXCEPTION '행사를 찾을 수 없습니다.'; END IF;
    IF v_status IN ('PROGRESS', 'FINISHED', 'CANCELLED') THEN
        RAISE EXCEPTION '대기/예약/배치 조율 단계에서만 슬롯을 생성할 수 있습니다. (현재: %)', v_status;
    END IF;

    v_step := p_session_minutes + p_break_minutes;

    -- 대상 전문가: 행사 참가 EXPERT (옵션으로 일부만 한정)
    FOR v_expert IN
        SELECT ep.user_id AS expert_id
        FROM public.event_participants ep
        WHERE ep.event_id = p_event_id
          AND ep.participant_type = 'EXPERT'
          AND (p_expert_ids IS NULL OR ep.user_id = ANY(p_expert_ids))
    LOOP
        -- 재생성: 해당 전문가의 빈 슬롯만 제거(예약/진행 슬롯은 보존). 제안(matching_proposals)은 FK CASCADE.
        IF p_replace_unbooked THEN
            DELETE FROM public.matching_slots s
            WHERE s.event_id = p_event_id
              AND s.expert_id = v_expert.expert_id
              AND s.startup_id IS NULL
              AND s.session_status = 'WAITING';
        END IF;

        FOR v_i IN 0..(p_session_count - 1) LOOP
            v_start := p_start_time + make_interval(mins => v_i * v_step);
            v_end := v_start + make_interval(mins => p_session_minutes);

            -- 같은 전문가의 보존된 슬롯과 시간이 겹치면 건너뛴다(중복/충돌 방지).
            IF EXISTS (
                SELECT 1 FROM public.matching_slots s
                WHERE s.event_id = p_event_id
                  AND s.expert_id = v_expert.expert_id
                  AND s.session_status <> 'CANCELLED'
                  AND s.start_time < v_end AND s.end_time > v_start
            ) THEN
                CONTINUE;
            END IF;

            INSERT INTO public.matching_slots
                (event_id, expert_id, start_time, end_time, booking_type, session_status)
            VALUES (p_event_id, v_expert.expert_id, v_start, v_end, 'NONE', 'WAITING');
            v_created := v_created + 1;
        END LOOP;
    END LOOP;

    RETURN v_created;
END;
$$;
REVOKE ALL ON FUNCTION public.generate_event_slots(UUID, TIMESTAMPTZ, INT, INT, INT, UUID[], BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_event_slots(UUID, TIMESTAMPTZ, INT, INT, INT, UUID[], BOOLEAN) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. 빈 슬롯 초기화 (예약/진행 슬롯은 보존)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_unbooked_slots(p_event_id UUID)
RETURNS INT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_status TEXT;
    v_deleted INT;
BEGIN
    IF public.current_app_role() <> 'ADMIN' THEN
        RAISE EXCEPTION '슬롯 초기화는 관리자만 가능합니다.';
    END IF;

    SELECT status INTO v_status FROM public.events WHERE id = p_event_id AND deleted_at IS NULL;
    IF v_status IS NULL THEN RAISE EXCEPTION '행사를 찾을 수 없습니다.'; END IF;
    IF v_status IN ('PROGRESS', 'FINISHED', 'CANCELLED') THEN
        RAISE EXCEPTION '대기/예약/배치 조율 단계에서만 슬롯을 초기화할 수 있습니다. (현재: %)', v_status;
    END IF;

    DELETE FROM public.matching_slots s
    WHERE s.event_id = p_event_id
      AND s.startup_id IS NULL
      AND s.session_status = 'WAITING';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_unbooked_slots(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_unbooked_slots(UUID) TO authenticated;
