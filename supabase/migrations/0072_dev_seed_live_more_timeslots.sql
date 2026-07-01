-- =============================================================================
-- 0072_dev_seed_live_more_timeslots.sql
--   0070(전원참가 LIVE 행사 F)에 시간대 열 10개를 더 추가(가로 스크롤/크게보기 확인용).
-- =============================================================================
-- 목적: 진행 현황 타임그리드의 "크게보기(가로 스크롤)"를 확인할 수 있도록, 행사 F 에
--       기존 6개 시간대 뒤로 10개 시간대를 더 이어 붙인다(전문가 전원 × 10 = 빈 슬롯).
--   - 기존 슬롯의 최대 시작시각(v_last)에서 50분(40분 상담 + 10분 휴식) 간격으로 이어 붙인다.
--   - 새 열은 예약 없는 빈 WAITING 슬롯(startup_id=NULL) — 그리드에서 '빈 슬롯 / + 배정' 으로 뜬다.
--   - 각 전문가의 기본 테이블(default_table_id)을 그대로 사용.
-- 멱등: 행사 F 슬롯 수가 이미 84(6열)를 초과하면(=이미 추가됨) 스킵.
-- =============================================================================

DO $$
DECLARE
    v_event  UUID := 'a0000000-0000-4000-8000-000000000006';
    v_last   TIMESTAMPTZ;
    v_stride INT := 50;
    v_dur    INT := 40;
    v_slots  INT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = v_event) THEN
        RAISE NOTICE '0072: LIVE 행사(F) 없음 — 0070 먼저 적용하세요. 스킵.';
        RETURN;
    END IF;

    SELECT count(*), max(start_time) INTO v_slots, v_last
    FROM public.matching_slots WHERE event_id = v_event;

    IF v_slots > 84 THEN
        RAISE NOTICE '0072: 이미 시간대 추가됨(슬롯 % > 84) — 스킵.', v_slots;
        RETURN;
    END IF;

    -- 전문가 전원 × 새 시간대 10개 = 빈 WAITING 슬롯.
    INSERT INTO public.matching_slots
        (event_id, expert_id, startup_id, start_time, end_time,
         table_id, booking_type, session_status)
    SELECT
        v_event,
        ep.user_id,
        NULL,
        v_last + make_interval(mins => i * v_stride),
        v_last + make_interval(mins => i * v_stride + v_dur),
        ep.default_table_id,
        'NONE',
        'WAITING'
    FROM public.event_participants ep
    CROSS JOIN generate_series(1, 10) AS i
    WHERE ep.event_id = v_event AND ep.participant_type = 'EXPERT';

    RAISE NOTICE '0072: 적용 완료 — 행사 F 에 시간대 10개 추가(전문가 전원 × 10 빈 슬롯).';
END $$;

-- =============================================================================
-- 롤백 스니펫: 추가한 빈 시간대만 제거하려면 v_last 이후의 빈 WAITING 슬롯을 지운다.
--   (간단히는 0070 롤백으로 행사 F 전체 삭제. 부분 롤백이 필요하면 아래 참고.)
-- DELETE FROM public.matching_slots ms
--  WHERE ms.event_id = 'a0000000-0000-4000-8000-000000000006'
--    AND ms.startup_id IS NULL AND ms.session_status = 'WAITING'
--    AND ms.start_time > (제거 기준 시각);
-- =============================================================================
