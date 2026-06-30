-- =============================================================================
-- 0048_expert_satisfaction.sql — 전문가별 만족도 (Phase 8-G)
-- 출처: docs/functional_followup_plan.md T6, docs/page_survey_customization.md §1,
--       docs/development_status.md 8-G. 정책 컬럼은 0047 에서 추가됨(events.satisfaction_policy).
-- -----------------------------------------------------------------------------
-- 목표: 기존 행사 만족도(EVENT 스코프)에 더해, 스타트업이 "상담한 전문가/세션별"로
--       응답하는 전문가 만족도(EXPERT 스코프)를 같은 동적 설문 인프라 위에 얹는다.
--
-- 사용자 합의(2026-06-28):
--   * 응답 자격 = 본인 예약 슬롯 중 취소(CANCELLED)·노쇼(NO_SHOW) 제외
--     (WAITING·IN_PROGRESS·COMPLETED). 실제 만난 전문가만 평가하되 출석 마킹 누락에 관대.
--   * 중복 차단 단위 = 상담 슬롯(slot). 동일 전문가 2회 예약 시 각 슬롯별 1회 응답.
--
-- 데이터 모델: 신규 테이블 없이 기존 3테이블을 스코프로 확장한다.
--   survey_questions.survey_scope      ('EVENT' | 'EXPERT')
--   survey_responses.survey_scope/target_expert_id/slot_id
--     - EVENT  : (event_id, user_id) 당 1회        (기존 동작 보존)
--     - EXPERT : (slot_id) 당 1회                  (상담 슬롯 기준 중복 차단)
--
-- 포함:
--   1. survey_questions/survey_responses 스코프 컬럼·제약·인덱스
--   2. EVENT UNIQUE → 부분 유니크(EVENT) + EXPERT 슬롯 유니크로 교체
--   3. 전문가 기본 문항 자동 프로비저닝(트리거 확장 + 기존 행사 backfill)
--   4. list_my_consulted_experts(event) — 응답 가능한 상담 슬롯 + 응답 여부
--   5. submit_expert_survey(event, slot, answers) — 슬롯 단위 원자적 제출 RPC
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. survey_questions — 스코프 컬럼
--   기존 행은 전부 행사 만족도이므로 DEFAULT 'EVENT' 로 자동 backfill.
-- -----------------------------------------------------------------------------
ALTER TABLE public.survey_questions
    ADD COLUMN IF NOT EXISTS survey_scope TEXT NOT NULL DEFAULT 'EVENT';

ALTER TABLE public.survey_questions
    DROP CONSTRAINT IF EXISTS chk_survey_question_scope;
ALTER TABLE public.survey_questions
    ADD CONSTRAINT chk_survey_question_scope CHECK (survey_scope IN ('EVENT', 'EXPERT'));

-- order_no 는 (event, scope, target_role) 단위로 의미를 가지므로 인덱스에 scope 포함.
DROP INDEX IF EXISTS idx_survey_questions_event_role;
CREATE INDEX IF NOT EXISTS idx_survey_questions_event_scope_role
    ON public.survey_questions (event_id, survey_scope, target_role, order_no);

-- -----------------------------------------------------------------------------
-- 2. survey_responses — 스코프 + 전문가/슬롯 참조
--   EVENT : target_expert_id/slot_id 는 NULL.
--   EXPERT: 둘 다 NOT NULL(슬롯에서 전문가 도출). CHECK 로 정합 강제.
-- -----------------------------------------------------------------------------
ALTER TABLE public.survey_responses
    ADD COLUMN IF NOT EXISTS survey_scope TEXT NOT NULL DEFAULT 'EVENT',
    ADD COLUMN IF NOT EXISTS target_expert_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS slot_id UUID REFERENCES public.matching_slots(id) ON DELETE CASCADE;

ALTER TABLE public.survey_responses
    DROP CONSTRAINT IF EXISTS chk_survey_response_scope;
ALTER TABLE public.survey_responses
    ADD CONSTRAINT chk_survey_response_scope CHECK (
        (survey_scope = 'EVENT'  AND target_expert_id IS NULL     AND slot_id IS NULL)
        OR (survey_scope = 'EXPERT' AND target_expert_id IS NOT NULL AND slot_id IS NOT NULL)
    );

-- 기존 전역 UNIQUE(event_id, user_id) 는 EXPERT 스코프(스타트업이 여러 전문가 응답)와 충돌.
-- → EVENT 스코프 전용 부분 유니크로 교체(기존 동작 보존), EXPERT 는 슬롯당 1회.
ALTER TABLE public.survey_responses
    DROP CONSTRAINT IF EXISTS unique_event_user_survey_response;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_event_survey_response
    ON public.survey_responses (event_id, user_id)
    WHERE survey_scope = 'EVENT';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_expert_survey_slot
    ON public.survey_responses (slot_id)
    WHERE survey_scope = 'EXPERT';

CREATE INDEX IF NOT EXISTS idx_survey_responses_expert
    ON public.survey_responses (event_id, target_expert_id)
    WHERE survey_scope = 'EXPERT';

-- -----------------------------------------------------------------------------
-- 3. 전문가 기본 문항 자동 프로비저닝
--   스타트업이 전문가를 평가하므로 target_role='STARTUP', survey_scope='EXPERT'.
--   행사에 EXPERT 스코프 문항이 하나도 없을 때만 채워 멱등.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_expert_survey_questions(p_event_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.survey_questions
        WHERE event_id = p_event_id AND survey_scope = 'EXPERT'
    ) THEN
        RETURN;
    END IF;
    INSERT INTO public.survey_questions
        (event_id, survey_scope, target_role, question_type, title, description, options, is_required, order_no)
    VALUES
        (p_event_id, 'EXPERT', 'STARTUP', 'RATING', '전문가 전문성', '상담 전문가의 전문성에 만족하셨나요?', NULL, TRUE, 1),
        (p_event_id, 'EXPERT', 'STARTUP', 'RATING', '상담 도움 정도', '상담 내용이 실질적으로 도움이 되었나요?', NULL, TRUE, 2),
        (p_event_id, 'EXPERT', 'STARTUP', 'RATING', '재상담 의향', '이 전문가와 다시 상담하고 싶으신가요?', NULL, TRUE, 3),
        (p_event_id, 'EXPERT', 'STARTUP', 'LONG_ANSWER', '전문가께 남길 의견', '상담 전문가에 대한 의견을 자유롭게 남겨 주세요.', NULL, FALSE, 4);
END $$;
REVOKE ALL ON FUNCTION public.ensure_default_expert_survey_questions(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_default_expert_survey_questions(UUID) FROM anon;

-- 행사 생성 트리거(0025 event_default_survey_after_insert)가 EVENT·EXPERT 둘 다 보장하도록 확장.
CREATE OR REPLACE FUNCTION public.trg_event_default_survey()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public.ensure_default_survey_questions(NEW.id);
    PERFORM public.ensure_default_expert_survey_questions(NEW.id);
    RETURN NEW;
END $$;

-- 기존 행사 전부 EXPERT 기본 문항 backfill(빌더 이전에도 문항이 존재하도록).
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT id FROM public.events LOOP
        PERFORM public.ensure_default_expert_survey_questions(r.id);
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 4. list_my_consulted_experts — 스타트업 본인이 응답 가능한 상담 슬롯 목록
--   참가자 커스텀 JWT 경로에서 호출. RLS 우회를 위해 SECURITY DEFINER 로 전문가 이름까지 조인.
--   응답 자격: 본인 예약 + session_status IN (WAITING, IN_PROGRESS, COMPLETED)(취소·노쇼 제외).
--   responded = 해당 슬롯에 이미 EXPERT 만족도 제출 여부.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_consulted_experts(p_event_id UUID)
RETURNS TABLE (
    slot_id             UUID,
    expert_id           UUID,
    expert_name         TEXT,
    expert_organization TEXT,
    start_time          TIMESTAMPTZ,
    end_time            TIMESTAMPTZ,
    session_status      TEXT,
    responded           BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user_id UUID := public.current_app_user_id();
    v_role    TEXT := public.current_app_role();
BEGIN
    -- 스타트업이 아니면 빈 결과(전문가/관리자에게는 노출하지 않음).
    IF v_user_id IS NULL OR v_role <> 'STARTUP' THEN
        RETURN;
    END IF;
    RETURN QUERY
        SELECT s.id,
               s.expert_id,
               u.name,
               u.expert_organization,
               s.start_time,
               s.end_time,
               s.session_status,
               EXISTS (
                   SELECT 1 FROM public.survey_responses r
                   WHERE r.slot_id = s.id AND r.survey_scope = 'EXPERT'
               ) AS responded
        FROM public.matching_slots s
        JOIN public.users u ON u.id = s.expert_id
        WHERE s.event_id = p_event_id
          AND s.startup_id = v_user_id
          AND s.session_status IN ('WAITING', 'IN_PROGRESS', 'COMPLETED')
        ORDER BY s.start_time;
END $$;
REVOKE ALL ON FUNCTION public.list_my_consulted_experts(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_my_consulted_experts(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_my_consulted_experts(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. submit_expert_survey — 슬롯 단위 전문가 만족도 원자적 제출
--   submit_survey(0025)와 동일한 답변 검증 로직을 EXPERT 스코프·슬롯 자격으로 감싼다.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_expert_survey(p_event_id UUID, p_slot_id UUID, p_answers JSONB)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user_id     UUID := public.current_app_user_id();
    v_role        TEXT := public.current_app_role();
    v_status      TEXT;
    v_slot        RECORD;
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
    IF v_role <> 'STARTUP' THEN
        RAISE EXCEPTION '스타트업만 전문가 만족도를 제출할 수 있습니다.' USING ERRCODE = '42501';
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

    -- 슬롯 자격 검증: 본인 예약 + 취소·노쇼 제외.
    SELECT s.id, s.event_id, s.expert_id, s.startup_id, s.session_status
      INTO v_slot
      FROM public.matching_slots s
     WHERE s.id = p_slot_id;
    IF v_slot.id IS NULL OR v_slot.event_id <> p_event_id THEN
        RAISE EXCEPTION '상담 정보를 찾을 수 없습니다.';
    END IF;
    IF v_slot.startup_id IS DISTINCT FROM v_user_id THEN
        RAISE EXCEPTION '본인이 상담한 전문가에 대해서만 응답할 수 있습니다.' USING ERRCODE = '42501';
    END IF;
    IF v_slot.session_status NOT IN ('WAITING', 'IN_PROGRESS', 'COMPLETED') THEN
        RAISE EXCEPTION '취소되었거나 진행되지 않은 상담은 응답할 수 없습니다.';
    END IF;

    -- 슬롯당 1회 제출: 마스터 INSERT. 부분 유니크(slot_id) 위반 = 이미 제출함.
    BEGIN
        INSERT INTO public.survey_responses
            (event_id, user_id, user_role, survey_scope, target_expert_id, slot_id)
        VALUES (p_event_id, v_user_id, 'STARTUP', 'EXPERT', v_slot.expert_id, p_slot_id)
        RETURNING id INTO v_response_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION '이미 이 상담에 대한 만족도를 제출하셨습니다.' USING ERRCODE = '23505';
    END;

    -- EXPERT 스코프 문항(스타트업 대상)을 순회하며 검증 + 저장(submit_survey 와 동일 규칙).
    FOR v_q IN
        SELECT * FROM public.survey_questions
        WHERE event_id = p_event_id
          AND survey_scope = 'EXPERT'
          AND (target_role = 'STARTUP' OR target_role = 'ALL')
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

-- 0023 패턴: anon 기본 EXECUTE 명시 회수 후 authenticated 에만 부여.
REVOKE ALL ON FUNCTION public.submit_expert_survey(UUID, UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_expert_survey(UUID, UUID, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_expert_survey(UUID, UUID, JSONB) TO authenticated;

-- =============================================================================
-- 롤백 스니펫
-- =============================================================================
-- DROP FUNCTION IF EXISTS public.submit_expert_survey(UUID, UUID, JSONB);
-- DROP FUNCTION IF EXISTS public.list_my_consulted_experts(UUID);
-- DROP FUNCTION IF EXISTS public.ensure_default_expert_survey_questions(UUID);
-- DELETE FROM public.survey_responses WHERE survey_scope = 'EXPERT';
-- DELETE FROM public.survey_questions WHERE survey_scope = 'EXPERT';
-- DROP INDEX IF EXISTS uniq_expert_survey_slot;
-- DROP INDEX IF EXISTS uniq_event_survey_response;
-- DROP INDEX IF EXISTS idx_survey_responses_expert;
-- ALTER TABLE public.survey_responses DROP CONSTRAINT IF EXISTS chk_survey_response_scope,
--   DROP COLUMN IF EXISTS slot_id, DROP COLUMN IF EXISTS target_expert_id, DROP COLUMN IF EXISTS survey_scope;
-- ALTER TABLE public.survey_questions DROP CONSTRAINT IF EXISTS chk_survey_question_scope,
--   DROP COLUMN IF EXISTS survey_scope;
-- (트리거 함수 trg_event_default_survey 는 0025 정의로 되돌릴 것)
-- =============================================================================
