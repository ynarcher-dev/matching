-- =============================================================================
-- 0025_survey_customization.sql
--   행사별 만족도 조사 커스터마이징 슬라이스 A (코어 데이터 모델 + 참가자 제출).
--   고정형 satisfaction_surveys(4점+의견)을 동적 문항 모델로 확장한다.
-- 출처: docs/survey_customization_ideation.md §2~§4, §6
-- -----------------------------------------------------------------------------
-- 이 마이그레이션이 포함하는 것:
--   1. survey_questions / survey_responses / survey_answers 3테이블 + RLS
--   2. 기본 STARTUP 템플릿 자동 프로비저닝(행사 생성 트리거 + 기존 행사 backfill)
--      → 관리자 빌더(슬라이스 B) 이전에도 모든 행사에 문항이 존재하도록 보장
--   3. submit_survey(event_id, answers jsonb) — 응답+답변 원자적 저장 RPC
--      (행사 FINISHED·참가자·role·필수·옵션·1회 제출을 서버에서 재검증)
--   4. dev seed — FINISHED 행사(C)에 참가자 + 샘플 응답(화면 확인용)
-- 범위 밖(이후 슬라이스): 관리자 빌더, 결과 리포트/CSV, EXPERT 설문.
-- 레거시 satisfaction_surveys 는 보존(deprecated)하며 이 마이그레이션에서 건드리지 않는다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 테이블
-- -----------------------------------------------------------------------------

-- A. 설문 문항 — 행사별 동적 문항 정의
CREATE TABLE public.survey_questions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id      UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    target_role   VARCHAR(20) NOT NULL DEFAULT 'STARTUP'
        CHECK (target_role IN ('STARTUP', 'EXPERT', 'ALL')),
    question_type VARCHAR(20) NOT NULL
        CHECK (question_type IN ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SHORT_ANSWER', 'LONG_ANSWER', 'RATING')),
    title         TEXT NOT NULL,
    description   TEXT,                       -- 문항 보조 설명(선택)
    options       JSONB,                      -- 객관식 선택지 배열(예: ["매우 만족","만족",...])
    is_required   BOOLEAN NOT NULL DEFAULT TRUE,
    order_no      INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ
);
CREATE INDEX idx_survey_questions_event_role ON public.survey_questions (event_id, target_role, order_no);

-- B. 설문 제출 마스터 — 행사당 1인 1회(UNIQUE 로 보장)
CREATE TABLE public.survey_responses (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id     UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    user_role    VARCHAR(20) NOT NULL CHECK (user_role IN ('STARTUP', 'EXPERT')),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_event_user_survey_response UNIQUE (event_id, user_id)
);
CREATE INDEX idx_survey_responses_event ON public.survey_responses (event_id);

-- C. 문항별 답변 — 제출 1건당 문항 N개
CREATE TABLE public.survey_answers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    response_id       UUID NOT NULL REFERENCES public.survey_responses(id) ON DELETE CASCADE,
    question_id       UUID NOT NULL REFERENCES public.survey_questions(id) ON DELETE CASCADE,
    answer_text       TEXT,                   -- 주관식 단답/서술
    answer_rating     INT CHECK (answer_rating BETWEEN 1 AND 5),  -- 평점형
    answer_selections JSONB,                  -- 객관식 선택 결과 배열
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_response_question UNIQUE (response_id, question_id)
);

-- -----------------------------------------------------------------------------
-- 2. RLS
--   - survey_questions: 참가자는 본인 행사 문항 SELECT 만, 쓰기는 ADMIN(슬라이스 B 빌더)
--   - survey_responses / survey_answers: 본인 SELECT(+ADMIN), 직접 INSERT 정책 없음
--     → 제출은 submit_survey(SECURITY DEFINER) 경유만 허용. UPDATE/DELETE 없음(수정 불가).
-- -----------------------------------------------------------------------------
ALTER TABLE public.survey_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_answers   ENABLE ROW LEVEL SECURITY;

-- survey_questions
CREATE POLICY survey_q_select ON public.survey_questions FOR SELECT TO authenticated
USING (public.current_app_role() = 'ADMIN' OR public.is_event_participant(event_id));
CREATE POLICY survey_q_insert ON public.survey_questions FOR INSERT TO authenticated
WITH CHECK (public.current_app_role() = 'ADMIN');
CREATE POLICY survey_q_update ON public.survey_questions FOR UPDATE TO authenticated
USING (public.current_app_role() = 'ADMIN') WITH CHECK (public.current_app_role() = 'ADMIN');
CREATE POLICY survey_q_delete ON public.survey_questions FOR DELETE TO authenticated
USING (public.current_app_role() = 'ADMIN');

-- survey_responses (본인/ADMIN SELECT 만 — INSERT 는 RPC 가 담당)
CREATE POLICY survey_r_select ON public.survey_responses FOR SELECT TO authenticated
USING (public.current_app_role() = 'ADMIN' OR user_id = public.current_app_user_id());

-- survey_answers (본인 응답에 속한 답변/ADMIN SELECT 만)
CREATE POLICY survey_a_select ON public.survey_answers FOR SELECT TO authenticated
USING (
    public.current_app_role() = 'ADMIN'
    OR EXISTS (
        SELECT 1 FROM public.survey_responses r
        WHERE r.id = response_id AND r.user_id = public.current_app_user_id()
    )
);

-- -----------------------------------------------------------------------------
-- 3. 기본 STARTUP 템플릿 자동 프로비저닝
--   레거시 4점 + 자유의견을 동적 문항(RATING 4 + LONG_ANSWER 1)으로 승계한다.
--   행사에 문항이 하나도 없을 때만 채워 넣어 멱등(idempotent).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_survey_questions(p_event_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.survey_questions WHERE event_id = p_event_id) THEN
        RETURN;
    END IF;
    INSERT INTO public.survey_questions
        (event_id, target_role, question_type, title, description, options, is_required, order_no)
    VALUES
        (p_event_id, 'STARTUP', 'RATING', '행사 전반 만족도', '행사 전반에 대해 얼마나 만족하셨나요?', NULL, TRUE, 1),
        (p_event_id, 'STARTUP', 'RATING', '매칭 적절성', '연결된 전문가와의 매칭이 적절했나요?', NULL, TRUE, 2),
        (p_event_id, 'STARTUP', 'RATING', '운영 만족도', '행사 운영(안내·진행)에 만족하셨나요?', NULL, TRUE, 3),
        (p_event_id, 'STARTUP', 'RATING', '재참여 의향', '다음에도 참여하실 의향이 있으신가요?', NULL, TRUE, 4),
        (p_event_id, 'STARTUP', 'LONG_ANSWER', '자유 의견', '행사 운영·매칭에 대한 의견을 자유롭게 남겨 주세요.', NULL, FALSE, 5);
END $$;
-- 내부 전용(트리거/마이그레이션) — 클라이언트 RPC 노출 금지.
REVOKE ALL ON FUNCTION public.ensure_default_survey_questions(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_default_survey_questions(UUID) FROM anon;

-- 행사 생성 시 기본 문항 자동 부여
CREATE OR REPLACE FUNCTION public.trg_event_default_survey()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public.ensure_default_survey_questions(NEW.id);
    RETURN NEW;
END $$;

CREATE TRIGGER event_default_survey_after_insert
AFTER INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION public.trg_event_default_survey();

-- 기존 행사 전부 backfill(빌더 이전에도 문항이 존재하도록)
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT id FROM public.events LOOP
        PERFORM public.ensure_default_survey_questions(r.id);
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 4. submit_survey — 응답 + 답변 원자적 저장 RPC
--   answers 형식(jsonb 배열):
--     [{ "question_id": uuid,
--        "answer_rating": 1..5 | null,
--        "answer_text": text | null,
--        "answer_selections": ["..."] | null }, ...]
--   서버 재검증: FINISHED · 참가자 · role 대상 · 필수 누락 · 타입별 형식 · 1회 제출.
-- -----------------------------------------------------------------------------
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
    IF v_role NOT IN ('STARTUP', 'EXPERT') THEN
        RAISE EXCEPTION '참가자만 만족도 조사를 제출할 수 있습니다.' USING ERRCODE = '42501';
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

    -- 1회 제출: 마스터 INSERT. UNIQUE 위반 = 이미 제출함.
    BEGIN
        INSERT INTO public.survey_responses (event_id, user_id, user_role)
        VALUES (p_event_id, v_user_id, v_role)
        RETURNING id INTO v_response_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION '이미 만족도 조사를 제출하셨습니다.' USING ERRCODE = '23505';
    END;

    -- 내 role(또는 ALL) 대상 문항을 순회하며 검증 + 저장.
    FOR v_q IN
        SELECT * FROM public.survey_questions
        WHERE event_id = p_event_id
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
                -- 모든 선택지가 정의된 옵션에 포함되는지(? = jsonb 배열 원소 존재)
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

-- 0023 패턴: anon 기본 EXECUTE 명시 회수 후 authenticated 에만 부여.
REVOKE ALL ON FUNCTION public.submit_survey(UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_survey(UUID, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_survey(UUID, JSONB) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. dev seed — FINISHED 행사(C)에서 동적 설문을 화면으로 확인하기 위한 더미.
--   0016 의 행사 C(바이오 파트너링데이)는 참가자/슬롯이 없으므로,
--   스타트업 5곳을 참가자로 추가하고 그중 3곳의 샘플 응답을 직접 INSERT 한다.
--   (RPC 는 ADMIN 가드/JWT 컨텍스트가 없어 마이그레이션에서 못 쓰므로 직접 INSERT)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_event_c UUID := 'a0000000-0000-4000-8000-000000000003'; -- FINISHED
    v_su      UUID;
    v_resp    UUID;
    v_q       RECORD;
    i         INT;
    v_ratings INT[] := ARRAY[5, 4, 5, 4];   -- 응답 1 (전반/매칭/운영/재참여)
BEGIN
    -- 행사 C 가 없거나(시드 미적용) 이미 참가자가 있으면 스킵
    IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = v_event_c) THEN
        RAISE NOTICE '0025 seed: 행사 C 없음 — 스킵';
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.event_participants WHERE event_id = v_event_c) THEN
        RAISE NOTICE '0025 seed: 행사 C 참가자 이미 존재 — 스킵';
        RETURN;
    END IF;

    -- 스타트업 5곳(50000000-...-01..05)을 행사 C 참가자로 추가
    FOR i IN 1..5 LOOP
        v_su := ('50000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
        IF EXISTS (SELECT 1 FROM public.users WHERE id = v_su) THEN
            INSERT INTO public.event_participants (event_id, user_id, participant_type)
            VALUES (v_event_c, v_su, 'STARTUP');
        END IF;
    END LOOP;

    -- 행사 C 기본 문항 보장(트리거가 이미 넣었겠지만 방어적으로)
    PERFORM public.ensure_default_survey_questions(v_event_c);

    -- 샘플 응답 3건(스타트업 01,02,03) — 평점 + 자유의견
    FOR i IN 1..3 LOOP
        v_su := ('50000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
        CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_su);

        INSERT INTO public.survey_responses (event_id, user_id, user_role)
        VALUES (v_event_c, v_su, 'STARTUP')
        RETURNING id INTO v_resp;

        FOR v_q IN
            SELECT * FROM public.survey_questions
            WHERE event_id = v_event_c AND target_role IN ('STARTUP', 'ALL')
            ORDER BY order_no
        LOOP
            IF v_q.question_type = 'RATING' THEN
                -- order_no 1..4 → 평점, 응답마다 약간씩 변형(1점씩 하강, 최저 1)
                INSERT INTO public.survey_answers (response_id, question_id, answer_rating)
                VALUES (v_resp, v_q.id, GREATEST(1, v_ratings[LEAST(v_q.order_no, 4)] - (i - 1)));
            ELSIF v_q.question_type = 'LONG_ANSWER' AND i = 1 THEN
                INSERT INTO public.survey_answers (response_id, question_id, answer_text)
                VALUES (v_resp, v_q.id, '매칭된 전문가 상담이 실질적으로 도움이 되었습니다. 다음에도 참여하고 싶습니다.');
            END IF;
        END LOOP;
    END LOOP;

    RAISE NOTICE '0025 seed: 행사 C 참가자 5 + 샘플 응답 3 적용 완료.';
END $$;

-- =============================================================================
-- 롤백 스니펫 (이 마이그레이션의 dev seed 데이터만 정리)
-- =============================================================================
-- DELETE FROM public.survey_responses WHERE event_id = 'a0000000-0000-4000-8000-000000000003';
-- DELETE FROM public.event_participants WHERE event_id = 'a0000000-0000-4000-8000-000000000003';
-- (테이블/트리거/RPC 자체를 되돌리려면 DROP TRIGGER event_default_survey_after_insert ON public.events;
--  DROP FUNCTION ... ; DROP TABLE survey_answers, survey_responses, survey_questions CASCADE;)
-- =============================================================================
