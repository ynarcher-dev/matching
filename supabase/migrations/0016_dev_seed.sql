-- =============================================================================
-- 0016_dev_seed.sql — 개발/화면 확인용 더미 데이터 (전문가 10 + 스타트업 50)
-- =============================================================================
-- 목적: 관리자 화면(유저 목록 / 행사 목록 / 행사 상세 — 참가자·예약현황·강제조정)
--       이 실제로 어떻게 보이는지 가시적으로 확인하기 위한 임시 시드.
--   - 고정 UUID + 단일 가드(행사 A 존재 여부)로 재실행 안전(idempotent).
--   - RPC(current_app_role ADMIN 가드)를 우회하기 위해 슬롯/예약을 직접 INSERT.
--   - 제거: 맨 아래 "롤백 스니펫" 주석 참고(이 마이그레이션의 데이터만 일괄 삭제).
-- 주의: 운영 데이터가 아니라 데모/확인용이며, 실제 인증 계정(auth_user_id)은 만들지 않음.
-- =============================================================================

DO $$
DECLARE
    v_event_a UUID := 'a0000000-0000-4000-8000-000000000001'; -- BOOKING (메인, 풀 데이터)
    v_event_b UUID := 'a0000000-0000-4000-8000-000000000002'; -- DRAFT (빈 행사)
    v_event_c UUID := 'a0000000-0000-4000-8000-000000000003'; -- FINISHED (과거 행사)
    v_start   TIMESTAMPTZ := '2026-07-15 09:00:00+09';        -- 행사 A 세션 시작 그리드
    v_fields  UUID[];
    -- 전문가/스타트업 표기용 한글 이름 풀
    v_expert_names TEXT[] := ARRAY[
        '김민준','이서연','박도윤','최지우','정하준','강수아','조은우','윤지호','임채원','한서진'];
    v_orgs TEXT[] := ARRAY[
        '한국과학기술원','서울대학교 기술지주','벤처스퀘어','퓨처벤처스','이노베이션랩',
        '한국투자파트너스','카카오벤처스','스파크랩','프라이머','본엔젤스'];
    v_positions TEXT[] := ARRAY[
        '책임연구원','기술이사(CTO)','수석심사역','파트너','대표심사역',
        '투자총괄','액셀러레이터 디렉터','기술자문위원','선임연구위원','심사역'];
    v_person_names TEXT[] := ARRAY[
        '김','이','박','최','정','강','조','윤','장','임','한','오','서','신','권',
        '황','안','송','류','홍'];
    v_tech_words TEXT[] := ARRAY[
        '넥스트','블루','그린','스마트','하이퍼','딥','퀀텀','노바','에코','뉴럴',
        '클라우드','바이오','로보','퓨처','메가'];
    v_suffix TEXT[] := ARRAY[
        '랩스','테크','웍스','에이아이','솔루션','시스템즈','네트웍스','다이나믹스'];
BEGIN
    -- ---- 가드: 이미 적용되었으면 전체 스킵 ------------------------------------
    IF EXISTS (SELECT 1 FROM public.events WHERE id = v_event_a) THEN
        RAISE NOTICE '0016_dev_seed: 이미 적용됨 — 스킵합니다.';
        RETURN;
    END IF;

    SELECT array_agg(id ORDER BY name) INTO v_fields FROM public.fields;
    IF v_fields IS NULL OR array_length(v_fields, 1) < 3 THEN
        RAISE EXCEPTION '0016_dev_seed: fields 마스터가 비어있습니다. seed.sql 먼저 적용하세요.';
    END IF;

    -- =========================================================================
    -- 1. 행사 3건
    -- =========================================================================
    INSERT INTO public.events
        (id, title, status, booking_start, booking_end, event_start, event_end,
         max_sessions_per_startup, allow_startup_self_booking)
    VALUES
        (v_event_a, '2026 와이엔아처 스타트업 IR 매칭데이', 'BOOKING',
         '2026-06-20 00:00:00+09', '2026-07-10 23:59:00+09',
         '2026-07-15 09:00:00+09', '2026-07-15 18:00:00+09', 3, FALSE),
        (v_event_b, '2026 하반기 딥테크 데모데이 (준비중)', 'DRAFT',
         '2026-08-01 00:00:00+09', '2026-08-20 23:59:00+09',
         '2026-08-25 10:00:00+09', '2026-08-25 17:00:00+09', 3, FALSE),
        (v_event_c, '2026 상반기 바이오 파트너링데이', 'FINISHED',
         '2026-05-01 00:00:00+09', '2026-05-10 23:59:00+09',
         '2026-05-15 09:00:00+09', '2026-05-15 18:00:00+09', 3, FALSE);

    -- =========================================================================
    -- 2. 사용자 — 전문가 10명 + 스타트업 50개 (고정 UUID)
    --    전문가 id: e0000000-...-0000000000NN  (NN=01..10)
    --    스타트업 id: 50000000-...-0000000000NN (NN=01..50)
    -- =========================================================================
    INSERT INTO public.users
        (id, email, name, role, phone_number,
         expert_organization, expert_position, expert_description)
    SELECT
        ('e0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
        'expert' || i || '@example.com',
        v_expert_names[i],
        'EXPERT',
        '010-2' || lpad(i::text, 3, '0') || '-' || lpad((1000 + i)::text, 4, '0'),
        v_orgs[i],
        v_positions[i],
        v_orgs[i] || ' 소속 ' || v_positions[i] || '. 초기 스타트업 기술·투자 심사 경험 다수.'
    FROM generate_series(1, 10) AS i;

    INSERT INTO public.users
        (id, email, name, role, phone_number,
         company_name, representative_name, contact_name,
         company_description, company_homepage)
    SELECT
        ('50000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
        'startup' || i || '@example.com',
        v_person_names[((i - 1) % 20) + 1] || '담당',
        'STARTUP',
        '010-3' || lpad(i::text, 3, '0') || '-' || lpad((2000 + i)::text, 4, '0'),
        v_tech_words[((i - 1) % 15) + 1] || v_suffix[((i * 3) % 8) + 1],
        v_person_names[(i % 20) + 1] || '대표',
        v_person_names[((i + 5) % 20) + 1] || '매니저',
        '혁신적인 솔루션을 개발하는 초기 단계 스타트업입니다. (시드 #' || i || ')',
        'https://startup' || i || '.example.com'
    FROM generate_series(1, 50) AS i;

    -- =========================================================================
    -- 3. 사용자 기본 분야 (각 1~3개, 최대 3 트리거 준수)
    -- =========================================================================
    -- 전문가: 3개 분야
    INSERT INTO public.user_fields (user_id, field_id)
    SELECT ('e0000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
           v_fields[((i + k * 4 - 1) % array_length(v_fields, 1)) + 1]
    FROM generate_series(1, 10) AS i, generate_series(0, 2) AS k;

    -- 스타트업: 2개 분야
    INSERT INTO public.user_fields (user_id, field_id)
    SELECT ('50000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
           v_fields[((i + k * 5 - 1) % array_length(v_fields, 1)) + 1]
    FROM generate_series(1, 50) AS i, generate_series(0, 1) AS k;

    -- =========================================================================
    -- 4. 행사 A — 테이블 10개 (전문가 기본 테이블)
    -- =========================================================================
    INSERT INTO public.event_tables (event_id, table_code, description)
    SELECT v_event_a, 'A-' || lpad(i::text, 2, '0'), i || '번 상담 테이블'
    FROM generate_series(1, 10) AS i;

    -- =========================================================================
    -- 5. 행사 A — 참가자 (전문가 10 + 스타트업 50)
    -- =========================================================================
    INSERT INTO public.event_participants (event_id, user_id, participant_type)
    SELECT v_event_a, u.id, 'EXPERT'
    FROM public.users u WHERE u.role = 'EXPERT';

    INSERT INTO public.event_participants (event_id, user_id, participant_type)
    SELECT v_event_a, u.id, 'STARTUP'
    FROM public.users u WHERE u.role = 'STARTUP';

    -- 전문가 참가자 → 기본 테이블 매핑(이메일 순 = 테이블 코드 순)
    WITH ex AS (
        SELECT ep.id, row_number() OVER (ORDER BY u.email) AS rn
        FROM public.event_participants ep
        JOIN public.users u ON u.id = ep.user_id
        WHERE ep.event_id = v_event_a AND ep.participant_type = 'EXPERT'
    ), tb AS (
        SELECT id, row_number() OVER (ORDER BY table_code) AS rn
        FROM public.event_tables WHERE event_id = v_event_a
    )
    UPDATE public.event_participants ep
    SET default_table_id = tb.id
    FROM ex JOIN tb ON tb.rn = ex.rn
    WHERE ep.id = ex.id;

    -- 행사별 참가 분야 = 사용자 기본 분야 복제(최대 3 트리거 준수)
    INSERT INTO public.event_participant_fields (event_participant_id, field_id)
    SELECT ep.id, uf.field_id
    FROM public.event_participants ep
    JOIN public.user_fields uf ON uf.user_id = ep.user_id
    WHERE ep.event_id = v_event_a;

    -- =========================================================================
    -- 6. 행사 A — 매칭 슬롯 (전문가 10 × 세션 6 = 60)
    --    세션 그리드: 40분 + 휴식 10분 = 50분 간격, 09:00 시작
    --    세션 0~2 → 예약됨(MANUAL/AUTO_AI/ADMIN_FORCE), 세션 3~5 → 빈 슬롯
    --    예약 스타트업 n = 세션idx*10 + 전문가rn (1..30, 각 1회 → 중복/충돌 없음)
    -- =========================================================================
    INSERT INTO public.matching_slots
        (event_id, expert_id, startup_id, start_time, end_time,
         table_id, booking_type, session_status)
    SELECT
        v_event_a,
        ex.user_id,
        CASE WHEN s.idx < 3
             THEN ('50000000-0000-4000-8000-' ||
                   lpad((s.idx * 10 + ex.rn)::text, 12, '0'))::uuid
             ELSE NULL END,
        v_start + make_interval(mins => s.idx * 50),
        v_start + make_interval(mins => s.idx * 50 + 40),
        ex.default_table_id,
        CASE s.idx WHEN 0 THEN 'MANUAL'
                   WHEN 1 THEN 'AUTO_AI'
                   WHEN 2 THEN 'ADMIN_FORCE'
                   ELSE 'NONE' END,
        'WAITING'
    FROM (
        SELECT ep.user_id, ep.default_table_id,
               row_number() OVER (ORDER BY u.email) AS rn
        FROM public.event_participants ep
        JOIN public.users u ON u.id = ep.user_id
        WHERE ep.event_id = v_event_a AND ep.participant_type = 'EXPERT'
    ) AS ex
    CROSS JOIN generate_series(0, 5) AS s(idx);

    -- =========================================================================
    -- 7. 행사 A — 예약 이력(감사 로그용 CREATED) — 예약된 슬롯 한정
    -- =========================================================================
    INSERT INTO public.booking_history
        (matching_slot_id, action_type, actor_id, startup_id, expert_id, reason)
    SELECT ms.id, 'CREATED', ms.startup_id, ms.startup_id, ms.expert_id, '개발용 시드 예약'
    FROM public.matching_slots ms
    WHERE ms.event_id = v_event_a AND ms.startup_id IS NOT NULL;

    RAISE NOTICE '0016_dev_seed: 적용 완료 — 전문가 10 / 스타트업 50 / 슬롯 60(예약 30).';
END $$;

-- =============================================================================
-- 롤백 스니펫 (이 시드 데이터만 일괄 삭제하고 싶을 때 수동 실행)
-- =============================================================================
-- DELETE FROM public.events WHERE id IN (
--     'a0000000-0000-4000-8000-000000000001',
--     'a0000000-0000-4000-8000-000000000002',
--     'a0000000-0000-4000-8000-000000000003');  -- 슬롯/참가자/이력 CASCADE 삭제
-- DELETE FROM public.users
--  WHERE id::text LIKE 'e0000000-0000-4000-8000-%'
--     OR id::text LIKE '50000000-0000-4000-8000-%';  -- user_fields CASCADE 삭제
-- =============================================================================
