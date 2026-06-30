-- =============================================================================
-- 0054_dev_seed_satisfaction_and_logs.sql — 회의 데모 행사(E) 만족도·상담일지 더미 채움
-- =============================================================================
-- 목적: 0053 회의 데모 행사(E)는 슬롯/참가자는 있으나 상담일지 답변·만족도 응답이
--       비어 있어 "상담일지 결과 / 행사 만족도 / 전문가 만족도" 화면이 0건으로 보인다.
--       이 시드는 그 세 화면을 눈으로 확인할 수 있도록 더미 데이터를 채운다.
--   1. 상담일지: 예약된(취소·노쇼 제외) 세션을 COMPLETED 로 맞추고, 슬롯당 상담일지 1건 +
--      커스텀 문항 답변(평점 5문항 + 상담 의견)을 채운다. 후속 연계/공개도 일부 표시.
--   2. 행사 만족도(EVENT 스코프): STARTUP 참가자별 응답 1건 + 문항 답변.
--   3. 전문가 만족도(EXPERT 스코프): 상담 슬롯(스타트업→전문가)별 응답 1건 + 문항 답변.
-- 멱등: 행사 E 에 EVENT 만족도 응답이 이미 있으면 전체 스킵. 개별 INSERT 도
--       ON CONFLICT/NOT EXISTS 로 재실행 안전. RPC 우회 직접 INSERT(컨벤션 dev_seed_convention.md).
-- 주의: 데모/확인용. NO_SHOW·CANCELLED 세션은 건드리지 않는다(일부 기업은 미완료로 남아
--       "기업 작성 완료" 분수가 자연스럽게 부분값이 되도록 한다).
-- =============================================================================

DO $$
DECLARE
    v_event UUID := 'a0000000-0000-4000-8000-000000000005'; -- 0053 회의 데모(LIVE) 행사
BEGIN
    -- ---- 가드 ---------------------------------------------------------------
    IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = v_event) THEN
        RAISE NOTICE '0054 seed: 회의 데모 행사(E) 없음 — 0053 먼저 적용하세요. 스킵.';
        RETURN;
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.survey_responses
        WHERE event_id = v_event AND survey_scope = 'EVENT'
    ) THEN
        RAISE NOTICE '0054 seed: 행사 E 만족도 응답 이미 존재 — 스킵.';
        RETURN;
    END IF;

    -- ---- 기본 문항 보장(트리거가 이미 생성했더라도 방어적) --------------------
    PERFORM public.ensure_default_counseling_questions(v_event);
    PERFORM public.ensure_default_survey_questions(v_event);
    PERFORM public.ensure_default_expert_survey_questions(v_event);

    -- =========================================================================
    -- 1. 상담일지
    -- =========================================================================
    -- 1-a. 예약된(취소·노쇼 제외) 세션을 COMPLETED 로 — 상담일지 작성 대상이 되도록.
    UPDATE public.matching_slots
    SET session_status = 'COMPLETED'
    WHERE event_id = v_event
      AND startup_id IS NOT NULL
      AND session_status NOT IN ('CANCELLED', 'NO_SHOW', 'COMPLETED');

    -- 1-b. COMPLETED 세션마다 상담일지 1건(없을 때만).
    INSERT INTO public.counseling_logs (matching_slot_id, submitted_at)
    SELECT ms.id, ms.end_time
    FROM public.matching_slots ms
    WHERE ms.event_id = v_event AND ms.session_status = 'COMPLETED'
    ON CONFLICT (matching_slot_id) DO NOTHING;

    -- 1-c. 후속 연계 / 공개 여부 — 일부만 표시되도록 결정적으로 부여.
    WITH logs AS (
        SELECT cl.id AS log_id,
               row_number() OVER (ORDER BY ms.start_time, ms.expert_id) AS n
        FROM public.counseling_logs cl
        JOIN public.matching_slots ms ON ms.id = cl.matching_slot_id
        WHERE ms.event_id = v_event AND ms.session_status = 'COMPLETED'
    )
    UPDATE public.counseling_logs cl
    SET follow_up_required = (l.n % 2 = 0),
        follow_up_memo = CASE WHEN l.n % 2 = 0
                              THEN '2주 내 후속 미팅 및 투자 검토 제안' ELSE NULL END,
        is_public = (l.n % 3 = 0)
    FROM logs l
    WHERE cl.id = l.log_id;

    -- 1-d. 커스텀 문항 답변 — 평점(3~5) + 상담 의견(서술). 슬롯 순번 n 으로 약간씩 변형.
    WITH logs AS (
        SELECT cl.id AS log_id,
               row_number() OVER (ORDER BY ms.start_time, ms.expert_id) AS n
        FROM public.counseling_logs cl
        JOIN public.matching_slots ms ON ms.id = cl.matching_slot_id
        WHERE ms.event_id = v_event AND ms.session_status = 'COMPLETED'
    )
    INSERT INTO public.counseling_log_answers (counseling_log_id, question_id, answer_rating)
    SELECT l.log_id, q.id, GREATEST(1, LEAST(5, 3 + ((l.n + q.order_no) % 3)))
    FROM logs l
    JOIN public.counseling_log_questions q
      ON q.event_id = v_event AND q.question_type = 'RATING'
    ON CONFLICT (counseling_log_id, question_id) DO NOTHING;

    WITH logs AS (
        SELECT cl.id AS log_id,
               row_number() OVER (ORDER BY ms.start_time, ms.expert_id) AS n
        FROM public.counseling_logs cl
        JOIN public.matching_slots ms ON ms.id = cl.matching_slot_id
        WHERE ms.event_id = v_event AND ms.session_status = 'COMPLETED'
    )
    INSERT INTO public.counseling_log_answers (counseling_log_id, question_id, answer_text)
    SELECT l.log_id, q.id,
           '상담 의견 #' || l.n || ': 기술 검증과 시장성을 논의했습니다. ' ||
           '초기 트랙션이 우수하며, 후속 IR 자료 보완과 파일럿 고객 확보를 권고했습니다.'
    FROM logs l
    JOIN public.counseling_log_questions q
      ON q.event_id = v_event AND q.question_type IN ('SHORT_ANSWER', 'LONG_ANSWER')
    ON CONFLICT (counseling_log_id, question_id) DO NOTHING;

    -- =========================================================================
    -- 2. 행사 만족도 (EVENT 스코프) — STARTUP 참가자별 응답 1건
    -- =========================================================================
    INSERT INTO public.survey_responses (event_id, user_id, user_role, survey_scope, submitted_at)
    SELECT v_event, ep.user_id, 'STARTUP', 'EVENT', now() - interval '1 day'
    FROM public.event_participants ep
    WHERE ep.event_id = v_event AND ep.participant_type = 'STARTUP';

    -- 평점 문항
    WITH resp AS (
        SELECT sr.id AS response_id,
               row_number() OVER (ORDER BY sr.user_id) AS i
        FROM public.survey_responses sr
        WHERE sr.event_id = v_event AND sr.survey_scope = 'EVENT'
    )
    INSERT INTO public.survey_answers (response_id, question_id, answer_rating)
    SELECT r.response_id, q.id, GREATEST(1, LEAST(5, 5 - ((r.i + q.order_no) % 3)))
    FROM resp r
    JOIN public.survey_questions q
      ON q.event_id = v_event AND q.survey_scope = 'EVENT'
     AND q.target_role IN ('STARTUP', 'ALL') AND q.question_type = 'RATING'
    ON CONFLICT (response_id, question_id) DO NOTHING;

    -- 서술 문항(일부 응답만)
    WITH resp AS (
        SELECT sr.id AS response_id,
               row_number() OVER (ORDER BY sr.user_id) AS i
        FROM public.survey_responses sr
        WHERE sr.event_id = v_event AND sr.survey_scope = 'EVENT'
    )
    INSERT INTO public.survey_answers (response_id, question_id, answer_text)
    SELECT r.response_id, q.id,
           '행사 운영과 매칭 모두 만족스러웠습니다. 내년에도 꼭 참여하고 싶습니다. (응답 ' || r.i || ')'
    FROM resp r
    JOIN public.survey_questions q
      ON q.event_id = v_event AND q.survey_scope = 'EVENT'
     AND q.target_role IN ('STARTUP', 'ALL')
     AND q.question_type IN ('SHORT_ANSWER', 'LONG_ANSWER')
    WHERE r.i <= 4
    ON CONFLICT (response_id, question_id) DO NOTHING;

    -- =========================================================================
    -- 3. 전문가 만족도 (EXPERT 스코프) — 상담 슬롯(스타트업→전문가)별 응답 1건
    -- =========================================================================
    INSERT INTO public.survey_responses
        (event_id, user_id, user_role, survey_scope, target_expert_id, slot_id, submitted_at)
    SELECT v_event, ms.startup_id, 'STARTUP', 'EXPERT', ms.expert_id, ms.id,
           now() - interval '12 hours'
    FROM public.matching_slots ms
    WHERE ms.event_id = v_event
      AND ms.startup_id IS NOT NULL
      AND ms.session_status IN ('WAITING', 'IN_PROGRESS', 'COMPLETED');

    -- 평점 문항(전문가 만족은 다소 높게 4~5)
    WITH resp AS (
        SELECT sr.id AS response_id,
               row_number() OVER (ORDER BY sr.slot_id) AS i
        FROM public.survey_responses sr
        WHERE sr.event_id = v_event AND sr.survey_scope = 'EXPERT'
    )
    INSERT INTO public.survey_answers (response_id, question_id, answer_rating)
    SELECT r.response_id, q.id, GREATEST(1, LEAST(5, 4 + ((r.i + q.order_no) % 2)))
    FROM resp r
    JOIN public.survey_questions q
      ON q.event_id = v_event AND q.survey_scope = 'EXPERT'
     AND q.target_role IN ('STARTUP', 'ALL') AND q.question_type = 'RATING'
    ON CONFLICT (response_id, question_id) DO NOTHING;

    -- 서술 문항(일부 응답만)
    WITH resp AS (
        SELECT sr.id AS response_id,
               row_number() OVER (ORDER BY sr.slot_id) AS i
        FROM public.survey_responses sr
        WHERE sr.event_id = v_event AND sr.survey_scope = 'EXPERT'
    )
    INSERT INTO public.survey_answers (response_id, question_id, answer_text)
    SELECT r.response_id, q.id,
           '전문가님의 피드백이 구체적이고 큰 도움이 되었습니다. 감사합니다. (응답 ' || r.i || ')'
    FROM resp r
    JOIN public.survey_questions q
      ON q.event_id = v_event AND q.survey_scope = 'EXPERT'
     AND q.target_role IN ('STARTUP', 'ALL')
     AND q.question_type IN ('SHORT_ANSWER', 'LONG_ANSWER')
    WHERE r.i <= 5
    ON CONFLICT (response_id, question_id) DO NOTHING;

    RAISE NOTICE '0054 seed: 행사 E 상담일지/행사 만족도/전문가 만족도 더미 적용 완료.';
END $$;

-- =============================================================================
-- 롤백 스니펫 (이 시드 데이터만 되돌리고 싶을 때 수동 실행)
-- =============================================================================
-- DO $$
-- DECLARE v_event UUID := 'a0000000-0000-4000-8000-000000000005';
-- BEGIN
--   DELETE FROM public.survey_responses WHERE event_id = v_event;        -- 답변 CASCADE
--   DELETE FROM public.counseling_log_answers a USING public.counseling_logs cl,
--          public.matching_slots ms
--    WHERE a.counseling_log_id = cl.id AND cl.matching_slot_id = ms.id AND ms.event_id = v_event;
--   -- (counseling_logs / 슬롯 상태는 0053 시드 소관 — 필요 시 별도 정리)
-- END $$;
-- =============================================================================
