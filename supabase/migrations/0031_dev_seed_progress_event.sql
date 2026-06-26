-- =============================================================================
-- 0031_dev_seed_progress_event.sql — 진행(PROGRESS) 단계 행사 더미 시드
-- =============================================================================
-- 목적: 관리자 "진행 현황" 대시보드(/admin/events/:id, 진행 현황 탭)와 전문가 대시보드를
--       눈으로 확인할 수 있도록 진행 중 행사 1건을 채운다.
--   - 전문가 4명 × 세션 5개 = 슬롯 20개. 세션 그리드는 now() 기준(현재 진행 중 세션 포함).
--   - 세션 상태 믹스: 완료(COMPLETED·상담일지 작성완료) / 진행중(IN_PROGRESS·일지 미작성)
--     / 대기(WAITING) / 불참(NO_SHOW) / 예약없음(빈 슬롯).
--   - 출석 로그(전문가/스타트업 PRESENT·ABSENT)도 함께 넣어 출석 칩이 보이게 한다.
--   - status_override=TRUE 로 고정해 1분 Cron 이 FINISHED 로 넘기지 않게 한다.
--   - 전문가/스타트업 계정은 0016_dev_seed 의 고정 UUID(e0000000.../50000000...)를 재사용.
--   - 고정 UUID + 단일 가드(행사 D 존재)로 재실행 안전(idempotent). RPC 우회 직접 INSERT.
-- =============================================================================

DO $$
DECLARE
    v_event_d UUID := 'a0000000-0000-4000-8000-000000000004'; -- PROGRESS (진행 현황 확인용)
    v_base    TIMESTAMPTZ := now() - interval '70 minutes';   -- 세션0 시작(과거) 기준점
BEGIN
    -- ---- 가드: 이미 적용되었으면 전체 스킵 ------------------------------------
    IF EXISTS (SELECT 1 FROM public.events WHERE id = v_event_d) THEN
        RAISE NOTICE '0031_dev_seed_progress_event: 이미 적용됨 — 스킵합니다.';
        RETURN;
    END IF;

    -- ---- 선행: 0016 의 전문가/스타트업이 있어야 한다 --------------------------
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = 'e0000000-0000-4000-8000-000000000001') THEN
        RAISE EXCEPTION '0031: 0016_dev_seed 의 전문가/스타트업이 없습니다. 0016 먼저 적용하세요.';
    END IF;

    -- =========================================================================
    -- 1. 진행 행사 (status_override 로 PROGRESS 고정)
    --    행사 시간 창이 now() 를 포함하도록 잡는다(시작 직전 ~ 충분히 이후).
    -- =========================================================================
    INSERT INTO public.events
        (id, title, status, status_override, status_override_reason,
         booking_start, booking_end, event_start, event_end,
         max_sessions_per_startup, allow_startup_self_booking)
    VALUES
        (v_event_d, '2026 와이엔아처 스타트업 상담 진행데이 (LIVE)', 'PROGRESS',
         TRUE, '개발용 시드: 진행 현황 확인용 상태 고정',
         now() - interval '20 days', now() - interval '3 days',
         now() - interval '1 hour', now() + interval '8 hours', 3, FALSE);

    -- =========================================================================
    -- 2. 행사장 테이블 4개
    -- =========================================================================
    INSERT INTO public.event_tables (event_id, table_code, description)
    SELECT v_event_d, 'D-' || lpad(i::text, 2, '0'), i || '번 상담 테이블'
    FROM generate_series(1, 4) AS i;

    -- =========================================================================
    -- 3. 참가자 — 전문가 4명(e..01~04) + 스타트업 16개(50..01~16)
    -- =========================================================================
    INSERT INTO public.event_participants (event_id, user_id, participant_type)
    SELECT v_event_d,
           ('e0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'EXPERT'
    FROM generate_series(1, 4) AS i;

    INSERT INTO public.event_participants (event_id, user_id, participant_type)
    SELECT v_event_d,
           ('50000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'STARTUP'
    FROM generate_series(1, 16) AS i;

    -- 전문가 기본 테이블 매핑(이메일 순 = 테이블 코드 순)
    WITH ex AS (
        SELECT ep.id, row_number() OVER (ORDER BY u.email) AS rn
        FROM public.event_participants ep
        JOIN public.users u ON u.id = ep.user_id
        WHERE ep.event_id = v_event_d AND ep.participant_type = 'EXPERT'
    ), tb AS (
        SELECT id, row_number() OVER (ORDER BY table_code) AS rn
        FROM public.event_tables WHERE event_id = v_event_d
    )
    UPDATE public.event_participants ep
    SET default_table_id = tb.id
    FROM ex JOIN tb ON tb.rn = ex.rn
    WHERE ep.id = ex.id;

    -- 행사 참가 분야 = 사용자 기본 분야 복제(최대 3 트리거 준수)
    INSERT INTO public.event_participant_fields (event_participant_id, field_id)
    SELECT ep.id, uf.field_id
    FROM public.event_participants ep
    JOIN public.user_fields uf ON uf.user_id = ep.user_id
    WHERE ep.event_id = v_event_d;

    -- =========================================================================
    -- 4. 매칭 슬롯 — 전문가 4 × 세션 5 = 20
    --    세션 그리드: 40분 상담 + 10분 휴식 = 50분 간격, v_base 시작.
    --    idx 0: 과거 → COMPLETED(rn1~3) / NO_SHOW(rn4)
    --    idx 1: now 포함 → IN_PROGRESS (진행중, 일지 미작성)
    --    idx 2~3: 미래 → WAITING
    --    idx 4: 빈 슬롯(예약 없음)
    --    예약 스타트업 = idx*4 + rn (idx<4, 1..16 각 1회 → 충돌 없음)
    -- =========================================================================
    INSERT INTO public.matching_slots
        (event_id, expert_id, startup_id, start_time, end_time,
         table_id, booking_type, session_status)
    SELECT
        v_event_d,
        ex.user_id,
        CASE WHEN s.idx < 4
             THEN ('50000000-0000-4000-8000-' ||
                   lpad((s.idx * 4 + ex.rn)::text, 12, '0'))::uuid
             ELSE NULL END,
        v_base + make_interval(mins => s.idx * 50),
        v_base + make_interval(mins => s.idx * 50 + 40),
        ex.default_table_id,
        CASE s.idx WHEN 0 THEN 'MANUAL'
                   WHEN 1 THEN 'AUTO_AI'
                   WHEN 2 THEN 'MANUAL'
                   WHEN 3 THEN 'ADMIN_FORCE'
                   ELSE 'NONE' END,
        CASE
            WHEN s.idx = 4 THEN 'WAITING'                 -- 빈 슬롯
            WHEN s.idx = 0 AND ex.rn = 4 THEN 'NO_SHOW'   -- 불참
            WHEN s.idx = 0 THEN 'COMPLETED'               -- 완료(일지 작성완료 대상)
            WHEN s.idx = 1 THEN 'IN_PROGRESS'             -- 진행중(일지 미작성)
            ELSE 'WAITING'                                -- 대기
        END
    FROM (
        SELECT ep.user_id, ep.default_table_id,
               row_number() OVER (ORDER BY u.email) AS rn
        FROM public.event_participants ep
        JOIN public.users u ON u.id = ep.user_id
        WHERE ep.event_id = v_event_d AND ep.participant_type = 'EXPERT'
    ) AS ex
    CROSS JOIN generate_series(0, 4) AS s(idx);

    -- =========================================================================
    -- 5. 상담일지 — COMPLETED 슬롯에만 작성(작성완료). IN_PROGRESS 는 미작성으로 둔다.
    --    점수/공개여부는 행마다 변주. submitted_at = 세션 종료 시각.
    -- =========================================================================
    INSERT INTO public.counseling_logs
        (matching_slot_id, score_technology, score_expertise, score_reliability,
         score_collaboration, score_probability, content,
         follow_up_required, follow_up_memo, is_public, submitted_at)
    SELECT
        c.id,
        3 + (c.n % 3), 4, 5 - (c.n % 2), 3 + (c.n % 2), 2 + (c.n % 3),
        '상담 결과 요약 #' || c.n || ': 기술 검증과 시장성 논의를 진행했습니다. ' ||
        '초기 트랙션이 인상적이며 후속 IR 자료 보완을 권고했습니다.',
        (c.n % 2 = 0),
        CASE WHEN c.n % 2 = 0 THEN '2주 내 후속 미팅 및 투자 검토 제안' ELSE NULL END,
        (c.n % 2 = 0),
        c.end_time
    FROM (
        SELECT ms.id, ms.end_time,
               row_number() OVER (ORDER BY ms.start_time, ms.expert_id) AS n
        FROM public.matching_slots ms
        WHERE ms.event_id = v_event_d AND ms.session_status = 'COMPLETED'
    ) AS c;

    -- =========================================================================
    -- 6. 출석 로그 — 완료/진행중/불참 세션에 한해 기록(대기는 미정으로 둠)
    -- =========================================================================
    -- 전문가 출석(완료·진행중·불참 모두 본인은 PRESENT)
    INSERT INTO public.attendance_logs
        (matching_slot_id, user_id, role_type, attendance_status, check_in_type, reason)
    SELECT ms.id, ms.expert_id, 'EXPERT', 'PRESENT', 'QR', NULL
    FROM public.matching_slots ms
    WHERE ms.event_id = v_event_d
      AND ms.session_status IN ('COMPLETED', 'IN_PROGRESS', 'NO_SHOW');

    -- 스타트업 출석(완료·진행중은 PRESENT)
    INSERT INTO public.attendance_logs
        (matching_slot_id, user_id, role_type, attendance_status, check_in_type, reason)
    SELECT ms.id, ms.startup_id, 'STARTUP', 'PRESENT', 'QR', NULL
    FROM public.matching_slots ms
    WHERE ms.event_id = v_event_d
      AND ms.startup_id IS NOT NULL
      AND ms.session_status IN ('COMPLETED', 'IN_PROGRESS');

    -- 스타트업 불참(NO_SHOW 세션)
    INSERT INTO public.attendance_logs
        (matching_slot_id, user_id, role_type, attendance_status, check_in_type, reason)
    SELECT ms.id, ms.startup_id, 'STARTUP', 'ABSENT', 'MANUAL', '시드: 스타트업 미참석(노쇼)'
    FROM public.matching_slots ms
    WHERE ms.event_id = v_event_d
      AND ms.startup_id IS NOT NULL
      AND ms.session_status = 'NO_SHOW';

    -- =========================================================================
    -- 7. 예약 이력(CREATED) — 예약된 슬롯 한정
    -- =========================================================================
    INSERT INTO public.booking_history
        (matching_slot_id, action_type, actor_id, startup_id, expert_id, reason)
    SELECT ms.id, 'CREATED', ms.startup_id, ms.startup_id, ms.expert_id, '개발용 시드 예약(진행행사)'
    FROM public.matching_slots ms
    WHERE ms.event_id = v_event_d AND ms.startup_id IS NOT NULL;

    RAISE NOTICE '0031_dev_seed_progress_event: 적용 완료 — 진행 행사 1 / 슬롯 20(완료 3·진행중 4·대기 8·불참 1·빈 4).';
END $$;

-- =============================================================================
-- 롤백 스니펫 (이 시드 데이터만 일괄 삭제하고 싶을 때 수동 실행)
-- =============================================================================
-- DELETE FROM public.events WHERE id = 'a0000000-0000-4000-8000-000000000004';
--   -- 슬롯/참가자/상담일지/출석/이력 CASCADE 삭제. (전문가/스타트업 계정은 0016 소유라 보존)
-- =============================================================================
