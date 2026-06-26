-- =============================================================================
-- 0028_dev_seed_survey_responses.sql — 만족도 결과 화면 확인용 샘플 응답(행사 C)
-- =============================================================================
-- 목적: 관리자 "만족도 결과" 탭에서 집계(응답률·평점 분포·객관식 비율·주관식 목록)가
--       실제로 어떻게 보이는지 확인하기 위한 임시 응답 데이터.
--   - 대상: 행사 C(FINISHED, 바이오 파트너링데이) STARTUP 참가자 최대 4명.
--   - 행사 C 의 STARTUP 문항(0025 기본 + 0027 예시 = 모든 유형)에 유형별로 응답을 채운다.
--   - 단일 가드(행사 C 응답 존재)로 재실행 안전.
-- 제거: 맨 아래 롤백 스니펫.
-- =============================================================================

DO $$
DECLARE
    v_event_c UUID := 'a0000000-0000-4000-8000-000000000003';
    v_part    RECORD;
    v_resp    UUID;
    v_q       RECORD;
    i         INT := 0;
    v_rating  INT;
    v_optcnt  INT;
    v_sel     JSONB;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = v_event_c) THEN
        RAISE NOTICE '0028 seed: 행사 C 없음 — 스킵';
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.survey_responses WHERE event_id = v_event_c) THEN
        RAISE NOTICE '0028 seed: 행사 C 응답 이미 존재 — 스킵';
        RETURN;
    END IF;

    -- 행사 C 기본 문항 보장(방어적)
    PERFORM public.ensure_default_survey_questions(v_event_c);

    FOR v_part IN
        SELECT ep.user_id
        FROM public.event_participants ep
        WHERE ep.event_id = v_event_c AND ep.participant_type = 'STARTUP'
        ORDER BY ep.user_id
        LIMIT 4
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
                v_rating := GREATEST(1, LEAST(5, 5 - ((i + v_q.order_no) % 3)));
                INSERT INTO public.survey_answers (response_id, question_id, answer_rating)
                VALUES (v_resp, v_q.id, v_rating);

            ELSIF v_q.question_type = 'SINGLE_CHOICE' THEN
                v_optcnt := jsonb_array_length(v_q.options);
                IF v_optcnt > 0 THEN
                    INSERT INTO public.survey_answers (response_id, question_id, answer_selections)
                    VALUES (v_resp, v_q.id, jsonb_build_array(v_q.options->>((i - 1) % v_optcnt)));
                END IF;

            ELSIF v_q.question_type = 'MULTIPLE_CHOICE' THEN
                v_optcnt := jsonb_array_length(v_q.options);
                IF v_optcnt > 0 THEN
                    v_sel := jsonb_build_array(v_q.options->>0);
                    IF v_optcnt > 1 AND (i % 2 = 0) THEN
                        v_sel := v_sel || jsonb_build_array(v_q.options->>1);
                    END IF;
                    INSERT INTO public.survey_answers (response_id, question_id, answer_selections)
                    VALUES (v_resp, v_q.id, v_sel);
                END IF;

            ELSIF v_q.question_type = 'SHORT_ANSWER' THEN
                IF i <= 3 THEN  -- 일부만 응답(비필수 표현)
                    INSERT INTO public.survey_answers (response_id, question_id, answer_text)
                    VALUES (v_resp, v_q.id, '바이오 분야 ' || i || '번 상담 전문가님');
                END IF;

            ELSIF v_q.question_type = 'LONG_ANSWER' THEN
                IF i <= 2 THEN
                    INSERT INTO public.survey_answers (response_id, question_id, answer_text)
                    VALUES (v_resp, v_q.id,
                            '매칭과 운영 모두 만족스러웠습니다. 내년에도 꼭 참여하고 싶습니다. (응답 ' || i || ')');
                END IF;
            END IF;
        END LOOP;
    END LOOP;

    IF i = 0 THEN
        RAISE NOTICE '0028 seed: 행사 C STARTUP 참가자가 없어 응답을 넣지 못했습니다.';
    ELSE
        RAISE NOTICE '0028 seed: 행사 C 샘플 응답 % 건 적용 완료.', i;
    END IF;
END $$;

-- =============================================================================
-- 롤백 스니펫
-- =============================================================================
-- DELETE FROM public.survey_responses WHERE event_id = 'a0000000-0000-4000-8000-000000000003';
--   (survey_answers 는 FK CASCADE 로 함께 삭제)
-- =============================================================================
