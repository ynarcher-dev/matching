-- =============================================================================
-- 0061_remove_expert_event_survey.sql
-- 전문가의 "행사 만족도(EVENT)" 작성 기능 제거.
--   배경: 전문가는 만족도 조사를 작성하지 않기로 함 → 행사 만족도는 스타트업 전용.
--   유지: 전문가 만족도(survey_scope='EXPERT', 스타트업 → 전문가 평가)는 그대로 둔다.
--
-- 변경 요약
--   1. 전문가가 제출한 EVENT 만족도 응답·답변 삭제(답변은 FK CASCADE).
--   2. EVENT 스코프의 전문가 대상(target_role='EXPERT') 문항·답변 삭제(CASCADE).
--   3. 향후 EVENT 스코프에 전문가 대상/응답이 생기지 않도록 CHECK 제약 추가.
--   4. submit_survey RPC: 스타트업 전용 + EVENT 스코프 문항만 검증/저장하도록 정정.
--      (기존 RPC 는 survey_scope 필터가 없어 EXPERT 스코프 문항까지 섞일 여지가 있었음)
-- =============================================================================

BEGIN;

-- 1. 전문가가 제출한 행사(EVENT) 만족도 응답 삭제 (survey_answers 는 ON DELETE CASCADE).
DELETE FROM public.survey_responses
WHERE survey_scope = 'EVENT' AND user_role = 'EXPERT';

-- 2. 전문가 대상(EVENT, target_role='EXPERT') 문항 삭제 (survey_answers 는 ON DELETE CASCADE).
--    target_role='ALL' 문항은 스타트업도 응답 대상이므로 유지한다.
DELETE FROM public.survey_questions
WHERE survey_scope = 'EVENT' AND target_role = 'EXPERT';

-- 3. EVENT 스코프에 전문가 대상/응답을 막는 제약(전문가 만족도=EXPERT 스코프는 영향 없음).
ALTER TABLE public.survey_questions
    DROP CONSTRAINT IF EXISTS chk_event_question_no_expert;
ALTER TABLE public.survey_questions
    ADD CONSTRAINT chk_event_question_no_expert
    CHECK (NOT (survey_scope = 'EVENT' AND target_role = 'EXPERT'));

ALTER TABLE public.survey_responses
    DROP CONSTRAINT IF EXISTS chk_event_response_no_expert;
ALTER TABLE public.survey_responses
    ADD CONSTRAINT chk_event_response_no_expert
    CHECK (NOT (survey_scope = 'EVENT' AND user_role = 'EXPERT'));

-- 4. submit_survey 정정: 스타트업 전용 + EVENT 스코프 문항만 처리.
CREATE OR REPLACE FUNCTION public.submit_survey(p_event_id UUID, p_answers JSONB)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user_id     UUID := public.current_app_user_id();
    v_role        TEXT := public.current_app_role();
    v_status      TEXT;
    v_response_id UUID;
    v_q           RECORD;
    v_ans         JSONB;
    v_rating      INT;
    v_text        TEXT;
    v_sel         JSONB;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = '42501';
    END IF;
    -- 행사 만족도는 스타트업만 제출한다(전문가 작성 기능 제거, 0061).
    IF v_role <> 'STARTUP' THEN
        RAISE EXCEPTION '행사 만족도는 스타트업만 제출할 수 있습니다.' USING ERRCODE = '42501';
    END IF;

    SELECT status INTO v_status FROM public.events WHERE id = p_event_id;
    IF v_status IS NULL THEN
        RAISE EXCEPTION '행사를 찾을 수 없습니다.';
    END IF;
    IF v_status <> 'FINISHED' THEN
        RAISE EXCEPTION '행사가 종료된 후에만 만족도 조사를 제출할 수 있습니다.';
    END IF;

    IF NOT public.is_event_participant(p_event_id) THEN
        RAISE EXCEPTION '이 행사의 참가자가 아닙니다.' USING ERRCODE = '42501';
    END IF;

    -- 1회 제출: 마스터 INSERT. 부분 UNIQUE(EVENT) 위반 = 이미 제출함.
    BEGIN
        INSERT INTO public.survey_responses (event_id, user_id, user_role, survey_scope)
        VALUES (p_event_id, v_user_id, v_role, 'EVENT')
        RETURNING id INTO v_response_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION '이미 만족도 조사를 제출하셨습니다.' USING ERRCODE = '23505';
    END;

    -- EVENT 스코프의 스타트업(또는 ALL) 대상 문항만 순회하며 검증 + 저장.
    FOR v_q IN
        SELECT * FROM public.survey_questions
        WHERE event_id = p_event_id
          AND survey_scope = 'EVENT'
          AND (target_role = v_role OR target_role = 'ALL')
        ORDER BY order_no
    LOOP
        SELECT a INTO v_ans
        FROM jsonb_array_elements(COALESCE(p_answers, '[]'::jsonb)) AS a
        WHERE (a->>'question_id')::uuid = v_q.id
        LIMIT 1;

        v_rating := NULLIF(v_ans->>'answer_rating', '')::int;
        v_text   := NULLIF(btrim(COALESCE(v_ans->>'answer_text', '')), '');
        v_sel    := v_ans->'answer_selections';

        -- 필수 누락 검사
        IF v_q.is_required THEN
            IF v_q.question_type = 'RATING' AND v_rating IS NULL THEN
                RAISE EXCEPTION '필수 항목에 응답해 주세요: %', v_q.title;
            ELSIF v_q.question_type IN ('SHORT_ANSWER', 'LONG_ANSWER') AND v_text IS NULL THEN
                RAISE EXCEPTION '필수 항목에 응답해 주세요: %', v_q.title;
            ELSIF v_q.question_type IN ('SINGLE_CHOICE', 'MULTIPLE_CHOICE')
                  AND (v_sel IS NULL OR jsonb_array_length(v_sel) = 0) THEN
                RAISE EXCEPTION '필수 항목에 응답해 주세요: %', v_q.title;
            END IF;
        END IF;

        -- 응답 없는 선택 항목은 건너뜀
        IF v_ans IS NULL THEN
            CONTINUE;
        END IF;

        -- 타입별 형식 검증 + 저장
        IF v_q.question_type = 'RATING' THEN
            IF v_rating IS NOT NULL THEN
                IF v_rating < 1 OR v_rating > 5 THEN
                    RAISE EXCEPTION '평점은 1~5 범위여야 합니다: %', v_q.title;
                END IF;
                INSERT INTO public.survey_answers (response_id, question_id, answer_rating)
                VALUES (v_response_id, v_q.id, v_rating);
            END IF;

        ELSIF v_q.question_type IN ('SHORT_ANSWER', 'LONG_ANSWER') THEN
            IF v_text IS NOT NULL THEN
                INSERT INTO public.survey_answers (response_id, question_id, answer_text)
                VALUES (v_response_id, v_q.id, v_text);
            END IF;

        ELSIF v_q.question_type IN ('SINGLE_CHOICE', 'MULTIPLE_CHOICE') THEN
            IF v_sel IS NOT NULL AND jsonb_array_length(v_sel) > 0 THEN
                IF v_q.question_type = 'SINGLE_CHOICE' AND jsonb_array_length(v_sel) <> 1 THEN
                    RAISE EXCEPTION '단일 선택 항목은 하나만 선택할 수 있습니다: %', v_q.title;
                END IF;
                IF v_q.options IS NULL OR EXISTS (
                    SELECT 1 FROM jsonb_array_elements_text(v_sel) AS s(val)
                    WHERE NOT (v_q.options ? s.val)
                ) THEN
                    RAISE EXCEPTION '유효하지 않은 선택지가 포함되어 있습니다: %', v_q.title;
                END IF;
                INSERT INTO public.survey_answers (response_id, question_id, answer_selections)
                VALUES (v_response_id, v_q.id, v_sel);
            END IF;
        END IF;
    END LOOP;

    RETURN v_response_id;
END $$;

COMMIT;
