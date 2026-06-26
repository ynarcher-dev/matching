-- =============================================================================
-- 0029_dev_seed_survey_responses_more.sql — 행사 C 만족도 응답 데이터 보강
-- =============================================================================
-- 목적: 0028 로 1건만 들어가(행사 C STARTUP 참가자 1명) 결과 화면이 빈약하므로,
--       스타트업 참가자를 추가하고 아직 응답이 없는 참가자에게 샘플 응답을 채운다.
--   - 스타트업 06~12(50000000-…-06..12)를 행사 C STARTUP 참가자로 추가(중복 방지).
--   - 행사 C STARTUP 참가자 중 응답이 없는 사람에게만 응답을 생성(멱등).
-- 제거: 0028 롤백 스니펫(행사 C survey_responses 삭제) + 아래 참가자 삭제.
-- =============================================================================

DO $$
DECLARE
    v_event_c UUID := 'a0000000-0000-4000-8000-000000000003';
    v_su      UUID;
    v_part    RECORD;
    v_resp    UUID;
    v_q       RECORD;
    i         INT := 0;
    v_rating  INT;
    v_optcnt  INT;
    v_sel     JSONB;
    k         INT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = v_event_c) THEN
        RAISE NOTICE '0029 seed: 행사 C 없음 — 스킵';
        RETURN;
    END IF;

    -- 스타트업 06~12 를 행사 C 참가자로 추가(이미 있으면 건너뜀)
    FOR k IN 6..12 LOOP
        v_su := ('50000000-0000-4000-8000-' || lpad(k::text, 12, '0'))::uuid;
        IF EXISTS (SELECT 1 FROM public.users WHERE id = v_su)
           AND NOT EXISTS (
               SELECT 1 FROM public.event_participants
               WHERE event_id = v_event_c AND user_id = v_su
           ) THEN
            INSERT INTO public.event_participants (event_id, user_id, participant_type)
            VALUES (v_event_c, v_su, 'STARTUP');
        END IF;
    END LOOP;

    -- 응답이 없는 STARTUP 참가자에게만 샘플 응답 생성
    FOR v_part IN
        SELECT ep.user_id
        FROM public.event_participants ep
        WHERE ep.event_id = v_event_c AND ep.participant_type = 'STARTUP'
          AND NOT EXISTS (
              SELECT 1 FROM public.survey_responses sr
              WHERE sr.event_id = v_event_c AND sr.user_id = ep.user_id
          )
        ORDER BY ep.user_id
    LOOP
        i := i + 1;
        INSERT INTO public.survey_responses (event_id, user_id, user_role)
        VALUES (v_event_c, v_part.user_id, 'STARTUP')
        RETURNING id INTO v_resp;

        FOR v_q IN
            SELECT * FROM public.survey_questions
            WHERE event_id = v_event_c AND target_role IN ('STARTUP', 'ALL')
            ORDER BY order_no
        LOOP
            IF v_q.question_type = 'RATING' THEN
                v_rating := GREATEST(1, LEAST(5, 3 + ((i + v_q.order_no) % 3)));
                INSERT INTO public.survey_answers (response_id, question_id, answer_rating)
                VALUES (v_resp, v_q.id, v_rating);

            ELSIF v_q.question_type = 'SINGLE_CHOICE' THEN
                v_optcnt := jsonb_array_length(v_q.options);
                IF v_optcnt > 0 THEN
                    INSERT INTO public.survey_answers (response_id, question_id, answer_selections)
                    VALUES (v_resp, v_q.id, jsonb_build_array(v_q.options->>(i % v_optcnt)));
                END IF;

            ELSIF v_q.question_type = 'MULTIPLE_CHOICE' THEN
                v_optcnt := jsonb_array_length(v_q.options);
                IF v_optcnt > 0 THEN
                    v_sel := jsonb_build_array(v_q.options->>(i % v_optcnt));
                    IF v_optcnt > 1 AND (i % 2 = 1) THEN
                        v_sel := v_sel || jsonb_build_array(v_q.options->>((i + 1) % v_optcnt));
                    END IF;
                    -- 중복 옵션 제거(같은 인덱스 가능성) 후 저장
                    INSERT INTO public.survey_answers (response_id, question_id, answer_selections)
                    VALUES (v_resp, v_q.id, (
                        SELECT jsonb_agg(DISTINCT e) FROM jsonb_array_elements_text(v_sel) AS e
                    ));
                END IF;

            ELSIF v_q.question_type = 'SHORT_ANSWER' THEN
                IF i % 2 = 0 THEN
                    INSERT INTO public.survey_answers (response_id, question_id, answer_text)
                    VALUES (v_resp, v_q.id, '바이오 분야 상담이 인상 깊었습니다 (' || i || ')');
                END IF;

            ELSIF v_q.question_type = 'LONG_ANSWER' THEN
                IF i % 3 <> 0 THEN
                    INSERT INTO public.survey_answers (response_id, question_id, answer_text)
                    VALUES (v_resp, v_q.id,
                            '전문가 매칭이 적절했고 운영도 매끄러웠습니다. 다음에도 참여 희망합니다. (' || i || ')');
                END IF;
            END IF;
        END LOOP;
    END LOOP;

    RAISE NOTICE '0029 seed: 행사 C 추가 응답 % 건 적용 완료.', i;
END $$;

-- =============================================================================
-- 롤백 스니펫
-- =============================================================================
-- DELETE FROM public.survey_responses WHERE event_id = 'a0000000-0000-4000-8000-000000000003';
-- DELETE FROM public.event_participants
--  WHERE event_id = 'a0000000-0000-4000-8000-000000000003'
--    AND user_id::text LIKE '50000000-0000-4000-8000-%';
-- =============================================================================
