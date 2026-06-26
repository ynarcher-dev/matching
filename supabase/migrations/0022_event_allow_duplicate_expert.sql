-- =============================================================================
-- 0022_event_allow_duplicate_expert.sql
--   행사 단위 설정 "동일 전문가 중복 예약 허용"(events.allow_duplicate_expert)을 추가하고,
--   슬롯 배정 검증(_validate_slot_assignment)의 "동일 전문가 2회 이상 금지" 규칙을
--   이 토글이 ON 일 때만 건너뛰도록 조건화한다(기본 OFF = 기존 명세 규칙 유지).
-- 출처: docs/page_startup_booking.md §2.1 (동일 전문가 중복 점검)
-- =============================================================================
-- 토글 ON 이어도 동시간 중복(스타트업/전문가)·실제 테이블 충돌은 여전히 차단된다
-- (한 사람이 같은 시간에 두 곳에 있을 수 없으므로). 연속/이격된 다른 시간대만 허용된다.
-- =============================================================================

ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS allow_duplicate_expert BOOLEAN NOT NULL DEFAULT FALSE;

-- 슬롯 배정 유효성 검증(0004 의 짝 — 동일 전문가 규칙만 행사 설정으로 조건화).
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
    v_allow_dup BOOLEAN;
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

    -- 동일 전문가 중복 예약 (같은 행사 내) — 행사 설정(allow_duplicate_expert)이 OFF 일 때만 차단
    SELECT allow_duplicate_expert INTO v_allow_dup FROM public.events WHERE id = p_slot.event_id;
    IF NOT COALESCE(v_allow_dup, FALSE) AND EXISTS (
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
