-- =============================================================================
-- 0053_dev_seed_meeting_event.sql — 회의 공유용 진행(PROGRESS) 행사 더미 시드
-- =============================================================================
-- 목적: 회의에서 "지금 진행 중인 행사"가 화면 곳곳에서 제대로 동작하는지 공유하기 위한
--       오늘자 기준 라이브 행사 1건. 0031 의 진행 행사는 생성 당시 now() 로 고정되어
--       라이브 세션이 이미 과거가 되므로, 이 시드를 적용하는 시점의 now() 로 새로 만든다.
--   - 전용 예시 전문가 3명 + 예시 기업(스타트업) 6개를 새 UUID 블록으로 생성(기존 시드와 무관).
--   - 슬롯: 전문가 3 × 세션 4 = 12. 세션 그리드는 적용 시점 now() 기준.
--       idx0: 과거  → COMPLETED(상담일지 작성) / NO_SHOW 1건
--       idx1: now 포함 → IN_PROGRESS (현재 진행 중, 일지 미작성)
--       idx2: 미래  → WAITING (예약됨, 대기)
--       idx3: 미래  → 빈 슬롯(예약 없음)
--   - 출석 로그/예약 이력도 함께 넣어 출석 칩·통계가 보이게 한다.
--   - status_override=TRUE 로 PROGRESS 고정 → 1분 Cron 이 FINISHED 로 넘기지 않게 한다.
--   - 고정 UUID + 단일 가드(행사 E 존재)로 재실행 안전(idempotent). RPC 우회 직접 INSERT.
-- 주의: 데모/확인용. 실제 인증 계정(auth_user_id)은 만들지 않는다.
-- =============================================================================

DO $$
DECLARE
    v_event_e UUID := 'a0000000-0000-4000-8000-000000000005'; -- PROGRESS (회의 공유용 LIVE)
    v_base    TIMESTAMPTZ := now() - interval '70 minutes';    -- 세션0 시작(과거) 기준점
    v_fields  UUID[];
    -- 예시 전문가 3명
    v_expert_names TEXT[] := ARRAY['김도현','이수민','박준영'];
    v_expert_orgs  TEXT[] := ARRAY['한국과학기술원','카카오벤처스','한국투자파트너스'];
    v_expert_pos   TEXT[] := ARRAY['책임연구원','수석심사역','투자총괄'];
    -- 예시 기업 6개
    v_co_names TEXT[] := ARRAY[
        '뉴럴브릿지','그린셀테크','메디플로우','페이로직','로보웨이브','에코머스'];
    v_co_reps  TEXT[] := ARRAY['정우성','한지민','오세훈','신민아','류준열','배수지'];
    v_co_descs TEXT[] := ARRAY[
        '온디바이스 AI 추론 가속 솔루션을 개발하는 초기 스타트업입니다.',
        '차세대 배터리 소재로 충전 효율을 높이는 친환경 딥테크 기업입니다.',
        '병원 데이터 연동 기반 환자 모니터링 헬스케어 플랫폼입니다.',
        '소상공인 대상 간편결제·정산 자동화 핀테크 서비스입니다.',
        '물류센터용 자율주행 운반 로봇을 만드는 로보틱스 스타트업입니다.',
        'AI 추천 기반 친환경 커머스 마켓플레이스를 운영합니다.'];
    -- 기업별 분야명(분야 마스터에서 id 조회) — 각 1~2개
    v_co_field1 TEXT[] := ARRAY['인공지능','친환경','헬스케어','핀테크','로봇','커머스'];
    v_co_field2 TEXT[] := ARRAY['제조','소재/부품','바이오','커머스','모빌리티','친환경'];
    -- 전문가별 분야명 — 각 2개
    v_ex_field1 TEXT[] := ARRAY['인공지능','친환경','핀테크'];
    v_ex_field2 TEXT[] := ARRAY['로봇','소재/부품','커머스'];
BEGIN
    -- ---- 가드: 이미 적용되었으면 전체 스킵 ------------------------------------
    IF EXISTS (SELECT 1 FROM public.events WHERE id = v_event_e) THEN
        RAISE NOTICE '0053_dev_seed_meeting_event: 이미 적용됨 — 스킵합니다.';
        RETURN;
    END IF;

    -- ---- 선행: 분야 마스터(seed.sql)가 있어야 한다 --------------------------
    IF NOT EXISTS (SELECT 1 FROM public.fields LIMIT 1) THEN
        RAISE EXCEPTION '0053: fields 마스터가 비어있습니다. seed.sql 먼저 적용하세요.';
    END IF;

    -- =========================================================================
    -- 1. 진행 행사 (status_override 로 PROGRESS 고정, now() 가 행사 창에 포함)
    -- =========================================================================
    INSERT INTO public.events
        (id, title, status, status_override, status_override_reason,
         booking_start, booking_end, event_start, event_end,
         max_sessions_per_startup, allow_startup_self_booking)
    VALUES
        (v_event_e, '2026 와이엔아처 스타트업 매칭데이 (회의 데모 · LIVE)', 'PROGRESS',
         TRUE, '회의 공유용 시드: 진행 현황 확인을 위한 상태 고정',
         now() - interval '14 days', now() - interval '2 days',
         now() - interval '1 hour', now() + interval '6 hours', 3, FALSE);

    -- =========================================================================
    -- 2. 예시 전문가 3명 (새 UUID 블록 e1000000-...)
    -- =========================================================================
    INSERT INTO public.users
        (id, email, name, role, phone_number,
         expert_organization, expert_position, expert_description)
    SELECT
        ('e1000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
        'demo.expert' || i || '@example.com',
        v_expert_names[i],
        'EXPERT',
        '010-5' || lpad(i::text, 3, '0') || '-' || lpad((1000 + i)::text, 4, '0'),
        v_expert_orgs[i],
        v_expert_pos[i],
        v_expert_orgs[i] || ' 소속 ' || v_expert_pos[i] || '. 초기 스타트업 기술·투자 심사 경험 다수.'
    FROM generate_series(1, 3) AS i;

    -- =========================================================================
    -- 3. 예시 기업(스타트업) 6개 (새 UUID 블록 51000000-...)
    -- =========================================================================
    INSERT INTO public.users
        (id, email, name, role, phone_number,
         company_name, representative_name, contact_name,
         company_description, company_homepage)
    SELECT
        ('51000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
        'demo.startup' || i || '@example.com',
        v_co_reps[i] || ' 담당',
        'STARTUP',
        '010-6' || lpad(i::text, 3, '0') || '-' || lpad((2000 + i)::text, 4, '0'),
        v_co_names[i],
        v_co_reps[i],
        v_co_reps[i] || ' 매니저',
        v_co_descs[i],
        'https://demo-startup' || i || '.example.com'
    FROM generate_series(1, 6) AS i;

    -- =========================================================================
    -- 4. 기본 분야 매핑 (분야명 → id 조회)
    -- =========================================================================
    -- 전문가 2개씩
    INSERT INTO public.user_fields (user_id, field_id)
    SELECT ('e1000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, f.id
    FROM generate_series(1, 3) AS i
    JOIN public.fields f ON f.name IN (v_ex_field1[i], v_ex_field2[i]);

    -- 기업 2개씩
    INSERT INTO public.user_fields (user_id, field_id)
    SELECT ('51000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, f.id
    FROM generate_series(1, 6) AS i
    JOIN public.fields f ON f.name IN (v_co_field1[i], v_co_field2[i]);

    -- =========================================================================
    -- 5. 행사장 테이블 3개
    -- =========================================================================
    INSERT INTO public.event_tables (event_id, table_code, description)
    SELECT v_event_e, 'E-' || lpad(i::text, 2, '0'), i || '번 상담 테이블'
    FROM generate_series(1, 3) AS i;

    -- =========================================================================
    -- 6. 참가자 — 전문가 3 + 기업 6
    -- =========================================================================
    INSERT INTO public.event_participants (event_id, user_id, participant_type)
    SELECT v_event_e,
           ('e1000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'EXPERT'
    FROM generate_series(1, 3) AS i;

    INSERT INTO public.event_participants (event_id, user_id, participant_type)
    SELECT v_event_e,
           ('51000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'STARTUP'
    FROM generate_series(1, 6) AS i;

    -- 전문가 기본 테이블 매핑(이메일 순 = 테이블 코드 순)
    WITH ex AS (
        SELECT ep.id, row_number() OVER (ORDER BY u.email) AS rn
        FROM public.event_participants ep
        JOIN public.users u ON u.id = ep.user_id
        WHERE ep.event_id = v_event_e AND ep.participant_type = 'EXPERT'
    ), tb AS (
        SELECT id, row_number() OVER (ORDER BY table_code) AS rn
        FROM public.event_tables WHERE event_id = v_event_e
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
    WHERE ep.event_id = v_event_e;

    -- =========================================================================
    -- 7. 매칭 슬롯 — 전문가 3 × 세션 4 = 12 (50분 간격: 40분 상담 + 10분 휴식)
    --    예약 기업 idx<3: ((idx*3 + rn - 1) % 6) + 1
    --      → 같은 시간대(idx)엔 서로 다른 기업, 시간대가 다르면 재사용(중복/충돌 없음).
    -- =========================================================================
    INSERT INTO public.matching_slots
        (event_id, expert_id, startup_id, start_time, end_time,
         table_id, booking_type, session_status)
    SELECT
        v_event_e,
        ex.user_id,
        CASE WHEN s.idx < 3
             THEN ('51000000-0000-4000-8000-' ||
                   lpad((((s.idx * 3 + ex.rn - 1) % 6) + 1)::text, 12, '0'))::uuid
             ELSE NULL END,
        v_base + make_interval(mins => s.idx * 50),
        v_base + make_interval(mins => s.idx * 50 + 40),
        ex.default_table_id,
        CASE s.idx WHEN 0 THEN 'MANUAL'
                   WHEN 1 THEN 'AUTO_AI'
                   WHEN 2 THEN 'ADMIN_FORCE'
                   ELSE 'NONE' END,
        CASE
            WHEN s.idx = 3 THEN 'WAITING'                 -- 빈 슬롯
            WHEN s.idx = 0 AND ex.rn = 3 THEN 'NO_SHOW'   -- 불참 1건
            WHEN s.idx = 0 THEN 'COMPLETED'               -- 완료(일지 작성 대상)
            WHEN s.idx = 1 THEN 'IN_PROGRESS'             -- 현재 진행 중(일지 미작성)
            ELSE 'WAITING'                                -- 대기(예약됨)
        END
    FROM (
        SELECT ep.user_id, ep.default_table_id,
               row_number() OVER (ORDER BY u.email) AS rn
        FROM public.event_participants ep
        JOIN public.users u ON u.id = ep.user_id
        WHERE ep.event_id = v_event_e AND ep.participant_type = 'EXPERT'
    ) AS ex
    CROSS JOIN generate_series(0, 3) AS s(idx);

    -- =========================================================================
    -- 8. 상담일지 — COMPLETED 슬롯에만 작성. IN_PROGRESS 는 미작성으로 둔다.
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
        WHERE ms.event_id = v_event_e AND ms.session_status = 'COMPLETED'
    ) AS c;

    -- =========================================================================
    -- 9. 출석 로그 — 완료/진행중/불참 세션에 한해 기록
    -- =========================================================================
    -- 전문가 출석(완료·진행중·불참 모두 본인은 PRESENT)
    INSERT INTO public.attendance_logs
        (matching_slot_id, user_id, role_type, attendance_status, check_in_type, reason)
    SELECT ms.id, ms.expert_id, 'EXPERT', 'PRESENT', 'QR', NULL
    FROM public.matching_slots ms
    WHERE ms.event_id = v_event_e
      AND ms.session_status IN ('COMPLETED', 'IN_PROGRESS', 'NO_SHOW');

    -- 기업 출석(완료·진행중은 PRESENT)
    INSERT INTO public.attendance_logs
        (matching_slot_id, user_id, role_type, attendance_status, check_in_type, reason)
    SELECT ms.id, ms.startup_id, 'STARTUP', 'PRESENT', 'QR', NULL
    FROM public.matching_slots ms
    WHERE ms.event_id = v_event_e
      AND ms.startup_id IS NOT NULL
      AND ms.session_status IN ('COMPLETED', 'IN_PROGRESS');

    -- 기업 불참(NO_SHOW 세션)
    INSERT INTO public.attendance_logs
        (matching_slot_id, user_id, role_type, attendance_status, check_in_type, reason)
    SELECT ms.id, ms.startup_id, 'STARTUP', 'ABSENT', 'MANUAL', '시드: 기업 미참석(노쇼)'
    FROM public.matching_slots ms
    WHERE ms.event_id = v_event_e
      AND ms.startup_id IS NOT NULL
      AND ms.session_status = 'NO_SHOW';

    -- =========================================================================
    -- 10. 예약 이력(CREATED) — 예약된 슬롯 한정
    -- =========================================================================
    INSERT INTO public.booking_history
        (matching_slot_id, action_type, actor_id, startup_id, expert_id, reason)
    SELECT ms.id, 'CREATED', ms.startup_id, ms.startup_id, ms.expert_id, '회의 데모 시드 예약'
    FROM public.matching_slots ms
    WHERE ms.event_id = v_event_e AND ms.startup_id IS NOT NULL;

    RAISE NOTICE '0053_dev_seed_meeting_event: 적용 완료 — 진행 행사 1 / 전문가 3 / 기업 6 / 슬롯 12(완료 2·진행중 3·대기 3·불참 1·빈 3).';
END $$;

-- =============================================================================
-- 롤백 스니펫 (이 시드 데이터만 일괄 삭제하고 싶을 때 수동 실행)
-- =============================================================================
-- DELETE FROM public.events WHERE id = 'a0000000-0000-4000-8000-000000000005';
--   -- 슬롯/참가자/상담일지/출석/이력 CASCADE 삭제.
-- DELETE FROM public.users
--  WHERE id::text LIKE 'e1000000-0000-4000-8000-%'
--     OR id::text LIKE '51000000-0000-4000-8000-%';  -- user_fields CASCADE 삭제
-- =============================================================================
