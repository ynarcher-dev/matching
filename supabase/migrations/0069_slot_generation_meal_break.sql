-- 0069: 슬롯 자동 생성에 식사(점심) 시간대 추가(최대 3개).
-- 규칙적으로 생성되는 세션 그리드 중간에 식사 구간을 지정하면,
-- 그 구간과 겹치는 세션은 구간 종료 시각 이후로 밀려 이어진다(커서 방식).
-- 식사 구간은 병렬 배열(p_meal_starts / p_meal_ends)로 최대 3개까지 전달한다.
-- 기존 7-인자 함수를 드롭하고 배열 2개를 더한 9-인자 버전으로 재정의.
DROP FUNCTION IF EXISTS public.generate_event_slots(UUID, TIMESTAMPTZ, INT, INT, INT, UUID[], BOOLEAN);

CREATE OR REPLACE FUNCTION public.generate_event_slots(
    p_event_id UUID,
    p_start_time TIMESTAMPTZ,
    p_session_minutes INT,
    p_session_count INT,
    p_break_minutes INT DEFAULT 0,
    p_expert_ids UUID[] DEFAULT NULL,
    p_replace_unbooked BOOLEAN DEFAULT TRUE,
    p_meal_starts TIMESTAMPTZ[] DEFAULT NULL,
    p_meal_ends TIMESTAMPTZ[] DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_status TEXT;
    v_created INT := 0;
    v_expert RECORD;
    v_i INT;
    v_m INT;
    v_cursor TIMESTAMPTZ;
    v_start TIMESTAMPTZ;
    v_end TIMESTAMPTZ;
    v_step INT;
    v_meal_count INT := 0;
    v_moved BOOLEAN;
BEGIN
    IF NOT public.can_manage_event(p_event_id) THEN
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

    -- 식사 구간 검증: 두 배열은 함께/같은 길이로, 최대 3개, 각 구간은 종료 > 시작.
    IF (p_meal_starts IS NULL) <> (p_meal_ends IS NULL) THEN
        RAISE EXCEPTION '식사 시작·종료 배열은 함께 지정해야 합니다.';
    END IF;
    IF p_meal_starts IS NOT NULL THEN
        IF COALESCE(array_length(p_meal_starts, 1), 0) <> COALESCE(array_length(p_meal_ends, 1), 0) THEN
            RAISE EXCEPTION '식사 시작·종료 개수가 일치해야 합니다.';
        END IF;
        v_meal_count := COALESCE(array_length(p_meal_starts, 1), 0);
        IF v_meal_count > 3 THEN
            RAISE EXCEPTION '식사 시간은 최대 3개까지 지정할 수 있습니다.';
        END IF;
        FOR v_m IN 1..v_meal_count LOOP
            IF p_meal_starts[v_m] IS NULL OR p_meal_ends[v_m] IS NULL
               OR p_meal_ends[v_m] <= p_meal_starts[v_m] THEN
                RAISE EXCEPTION '식사 종료 시각은 시작보다 늦어야 합니다.';
            END IF;
        END LOOP;
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

        -- 커서 방식: 시작 시각에서 (세션+휴식)만큼 전진하며 배치하되,
        -- 세션이 식사 구간과 겹치면 커서를 그 구간 종료로 점프해 이후로 이어간다.
        -- 여러 구간이 인접/연속이면 겹침이 사라질 때까지 반복 점프.
        v_cursor := p_start_time;
        FOR v_i IN 0..(p_session_count - 1) LOOP
            IF v_meal_count > 0 THEN
                LOOP
                    v_moved := FALSE;
                    FOR v_m IN 1..v_meal_count LOOP
                        IF v_cursor < p_meal_ends[v_m]
                           AND (v_cursor + make_interval(mins => p_session_minutes)) > p_meal_starts[v_m] THEN
                            v_cursor := p_meal_ends[v_m];
                            v_moved := TRUE;
                        END IF;
                    END LOOP;
                    EXIT WHEN NOT v_moved;
                END LOOP;
            END IF;

            v_start := v_cursor;
            v_end := v_start + make_interval(mins => p_session_minutes);
            v_cursor := v_cursor + make_interval(mins => v_step); -- 다음 세션용 전진(스킵돼도 유지)

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
REVOKE ALL ON FUNCTION public.generate_event_slots(UUID, TIMESTAMPTZ, INT, INT, INT, UUID[], BOOLEAN, TIMESTAMPTZ[], TIMESTAMPTZ[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_event_slots(UUID, TIMESTAMPTZ, INT, INT, INT, UUID[], BOOLEAN, TIMESTAMPTZ[], TIMESTAMPTZ[]) TO authenticated;
