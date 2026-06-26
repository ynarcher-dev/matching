-- =============================================================================
-- 0032_counseling_log_customization.sql
--   전문가 상담일지 평가표 커스터마이징 슬라이스 A (코어 데이터 모델 + 기본 템플릿).
--   고정형 스코어카드(counseling.ts SCORECARD_ITEMS + counseling_logs 고정 컬럼)를
--   행사별 동적 문항 모델로 확장한다.
-- 출처: docs/counseling_log_customization.md §4, §9(슬라이스 A)
-- -----------------------------------------------------------------------------
-- 이 마이그레이션이 포함하는 것:
--   1. counseling_log_questions / counseling_log_answers 2테이블 + RLS
--   2. 기본 상담일지 템플릿 자동 프로비저닝(행사 생성 트리거 + 기존 행사 backfill)
--      → 관리자 빌더(슬라이스 C) 이전에도 모든 행사에 문항이 존재하도록 보장
--   3. dev seed — PROGRESS 행사(D)에 커스텀 상담일지 문항 예시 추가 +
--      기존 COMPLETED 일지의 레거시 점수/의견을 동적 답변으로 backfill(화면 확인용)
-- -----------------------------------------------------------------------------
-- 설계 핵심 — system_key 양방향 매핑:
--   기본 템플릿 6문항은 system_key(score_technology … content)로 counseling_logs 의
--   레거시 컬럼과 1:1 매핑된다. v2 RPC(슬라이스 B)는 답변 저장 시 system_key 문항을
--   레거시 컬럼에도 동기화하고, 프론트는 동적 답변이 없으면 레거시 컬럼을 fallback 으로
--   읽어 list_public_comments(0023)·이전 이력·CSV 가 깨지지 않게 한다.
-- 범위 밖(이후 슬라이스): v2 저장/제출 RPC(B), 관리자 빌더(C), 전문가 모달(D), CSV(E).
-- 레거시 counseling_logs 고정 컬럼/RPC(0005)는 보존하며 이 마이그레이션에서 건드리지 않는다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 테이블
-- -----------------------------------------------------------------------------

-- A. 상담일지 문항 — 행사별 동적 문항 정의
CREATE TABLE public.counseling_log_questions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id          UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    question_type     VARCHAR(20) NOT NULL
        CHECK (question_type IN ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SHORT_ANSWER', 'LONG_ANSWER', 'RATING')),
    title             TEXT NOT NULL,
    description       TEXT,                        -- 문항 보조 설명(선택)
    options           JSONB,                       -- 객관식 선택지 배열
    is_required       BOOLEAN NOT NULL DEFAULT TRUE,
    order_no          INT NOT NULL DEFAULT 0,
    answer_visibility VARCHAR(20) NOT NULL DEFAULT 'ADMIN_ONLY'
        CHECK (answer_visibility IN ('ADMIN_ONLY', 'STARTUP_VISIBLE')),
    -- 기본 템플릿/호환 필드 식별자. 제목을 바꿔도 레거시 컬럼·공개 코멘트 매핑을 안정적으로 찾는다.
    -- 값 예: score_technology, score_expertise, score_reliability, score_collaboration,
    --        score_probability, content. NULL = 운영자가 추가한 순수 커스텀 문항.
    system_key        VARCHAR(40),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ
);
CREATE INDEX idx_clog_questions_event ON public.counseling_log_questions (event_id, order_no);
-- 한 행사에서 같은 system_key 는 최대 1개(레거시 매핑이 1:1 이도록).
CREATE UNIQUE INDEX uq_clog_questions_event_system_key
    ON public.counseling_log_questions (event_id, system_key)
    WHERE system_key IS NOT NULL;

-- B. 상담일지 답변 — 상담 슬롯별 문항 답변. 마스터는 기존 counseling_logs(슬롯당 1행).
CREATE TABLE public.counseling_log_answers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    counseling_log_id UUID NOT NULL REFERENCES public.counseling_logs(id) ON DELETE CASCADE,
    question_id       UUID NOT NULL REFERENCES public.counseling_log_questions(id) ON DELETE RESTRICT,
    answer_text       TEXT,                        -- 주관식 단답/서술
    answer_rating     INT CHECK (answer_rating BETWEEN 1 AND 5),  -- 평점형
    answer_selections JSONB,                       -- 객관식 선택 결과 배열
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ,
    CONSTRAINT unique_clog_answer_question UNIQUE (counseling_log_id, question_id)
);
CREATE INDEX idx_clog_answers_log ON public.counseling_log_answers (counseling_log_id);

-- -----------------------------------------------------------------------------
-- 2. RLS
--   - questions: 참가자(본인 행사)는 SELECT, 쓰기는 ADMIN(슬라이스 C 빌더)
--   - answers: 작성 전문가 본인 + ADMIN SELECT 만(직접 INSERT 정책 없음 → v2 RPC 경유).
--     ⭐스타트업은 내부 답변(점수/선택/주관식)을 절대 못 본다. 공개 코멘트는 기존
--     list_public_comments(content 컬럼)만 노출한다(0023). UPDATE/DELETE 정책 없음.
-- -----------------------------------------------------------------------------
ALTER TABLE public.counseling_log_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counseling_log_answers   ENABLE ROW LEVEL SECURITY;

-- counseling_log_questions
CREATE POLICY clog_q_select ON public.counseling_log_questions FOR SELECT TO authenticated
USING (public.current_app_role() = 'ADMIN' OR public.is_event_participant(event_id));
CREATE POLICY clog_q_insert ON public.counseling_log_questions FOR INSERT TO authenticated
WITH CHECK (public.current_app_role() = 'ADMIN');
CREATE POLICY clog_q_update ON public.counseling_log_questions FOR UPDATE TO authenticated
USING (public.current_app_role() = 'ADMIN') WITH CHECK (public.current_app_role() = 'ADMIN');
CREATE POLICY clog_q_delete ON public.counseling_log_questions FOR DELETE TO authenticated
USING (public.current_app_role() = 'ADMIN');

-- counseling_log_answers (작성 전문가/ADMIN SELECT 만 — INSERT/UPDATE 는 v2 RPC 가 담당)
CREATE POLICY clog_a_select ON public.counseling_log_answers FOR SELECT TO authenticated
USING (
    public.current_app_role() = 'ADMIN'
    OR EXISTS (
        SELECT 1
        FROM public.counseling_logs cl
        JOIN public.matching_slots s ON s.id = cl.matching_slot_id
        WHERE cl.id = counseling_log_id
          AND s.expert_id = public.current_app_user_id()
    )
);

-- -----------------------------------------------------------------------------
-- 3. 기본 상담일지 템플릿 자동 프로비저닝
--   레거시 5점 스코어카드 + 상담 의견을 동적 문항(RATING 5 + LONG_ANSWER 1)으로 승계한다.
--   system_key 로 counseling_logs 레거시 컬럼과 1:1 매핑한다.
--   행사에 문항이 하나도 없을 때만 채워 넣어 멱등(idempotent).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_counseling_questions(p_event_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.counseling_log_questions WHERE event_id = p_event_id) THEN
        RETURN;
    END IF;
    INSERT INTO public.counseling_log_questions
        (event_id, question_type, title, description, options, is_required, order_no, system_key)
    VALUES
        (p_event_id, 'RATING', '기술성', '보유 기술의 깊이 및 구현 완성도', NULL, TRUE, 1, 'score_technology'),
        (p_event_id, 'RATING', '전문성', '팀 구성 및 전문 분야 역량', NULL, TRUE, 2, 'score_expertise'),
        (p_event_id, 'RATING', '신뢰도', '인터뷰 태도 및 커뮤니케이션 성실함', NULL, TRUE, 3, 'score_reliability'),
        (p_event_id, 'RATING', '협업 잠재력', '파트너십·후속 연계 가능성', NULL, TRUE, 4, 'score_collaboration'),
        (p_event_id, 'RATING', '거래 가능성', '단기 내 실질적 비즈니스 매칭 성사 확률', NULL, TRUE, 5, 'score_probability'),
        (p_event_id, 'LONG_ANSWER', '상담 의견', '스타트업의 애로사항과 상담 코칭 요약을 기록해 주세요.', NULL, FALSE, 6, 'content');
END $$;
-- 내부 전용(트리거/마이그레이션) — 클라이언트 RPC 노출 금지.
REVOKE ALL ON FUNCTION public.ensure_default_counseling_questions(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_default_counseling_questions(UUID) FROM anon;

-- 행사 생성 시 기본 상담일지 문항 자동 부여
CREATE OR REPLACE FUNCTION public.trg_event_default_counseling()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public.ensure_default_counseling_questions(NEW.id);
    RETURN NEW;
END $$;

CREATE TRIGGER event_default_counseling_after_insert
AFTER INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION public.trg_event_default_counseling();

-- 기존 행사 전부 backfill(빌더 이전에도 문항이 존재하도록)
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT id FROM public.events LOOP
        PERFORM public.ensure_default_counseling_questions(r.id);
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 4. dev seed — PROGRESS 행사(D)에 커스텀 문항 예시 + 기존 일지 답변 backfill.
--   목적: 전문가 동적 상담일지 모달(슬라이스 D)·이전 이력(E)을 화면으로 확인.
--   - 행사 D(2026-... 진행데이)는 0031 에서 슬롯 20 + COMPLETED 일지 3건이 있다.
--   - 위 backfill 이 기본 6문항을 이미 부여했으므로, 여기서는 운영자 커스텀 문항 2개를
--     추가(단일 선택 + 단답)해 "커스터마이즈된 상담일지"를 시연한다.
--   - 기존 COMPLETED 일지(레거시 컬럼만 있음)의 점수/의견을 system_key 매핑으로
--     counseling_log_answers 에 backfill 한다(동적 이력/CSV 가 바로 채워 보이도록).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_event_d UUID := 'a0000000-0000-4000-8000-000000000004'; -- PROGRESS
    v_q       RECORD;
    v_log     RECORD;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = v_event_d) THEN
        RAISE NOTICE '0032 seed: 행사 D 없음 — 스킵';
        RETURN;
    END IF;

    -- 커스텀 문항 2개 추가(이미 있으면 스킵). order_no 7,8 — 기본 6문항 뒤에 붙인다.
    IF NOT EXISTS (
        SELECT 1 FROM public.counseling_log_questions
        WHERE event_id = v_event_d AND system_key IS NULL
    ) THEN
        INSERT INTO public.counseling_log_questions
            (event_id, question_type, title, description, options, is_required, order_no, system_key)
        VALUES
            (v_event_d, 'SINGLE_CHOICE', '투자 단계 적합성',
             '현재 스타트업의 투자 라운드 적합도를 선택해 주세요.',
             '["시드 이전","시드","프리A","시리즈A 이상"]'::jsonb, TRUE, 7, NULL),
            (v_event_d, 'SHORT_ANSWER', '핵심 후속 액션',
             '다음 미팅까지 스타트업이 준비할 한 가지를 적어 주세요.', NULL, FALSE, 8, NULL);
    END IF;

    -- 기존 COMPLETED 일지의 레거시 점수/의견을 동적 답변으로 backfill(멱등).
    FOR v_log IN
        SELECT cl.id, cl.score_technology, cl.score_expertise, cl.score_reliability,
               cl.score_collaboration, cl.score_probability, cl.content
        FROM public.counseling_logs cl
        JOIN public.matching_slots s ON s.id = cl.matching_slot_id
        WHERE s.event_id = v_event_d
    LOOP
        FOR v_q IN
            SELECT id, system_key, question_type
            FROM public.counseling_log_questions
            WHERE event_id = v_event_d AND system_key IS NOT NULL
        LOOP
            -- 이미 답변이 있으면 스킵
            CONTINUE WHEN EXISTS (
                SELECT 1 FROM public.counseling_log_answers
                WHERE counseling_log_id = v_log.id AND question_id = v_q.id
            );

            IF v_q.question_type = 'RATING' THEN
                INSERT INTO public.counseling_log_answers (counseling_log_id, question_id, answer_rating)
                VALUES (v_log.id, v_q.id, CASE v_q.system_key
                    WHEN 'score_technology'    THEN v_log.score_technology
                    WHEN 'score_expertise'     THEN v_log.score_expertise
                    WHEN 'score_reliability'   THEN v_log.score_reliability
                    WHEN 'score_collaboration' THEN v_log.score_collaboration
                    WHEN 'score_probability'   THEN v_log.score_probability END);
            ELSIF v_q.system_key = 'content' AND v_log.content IS NOT NULL THEN
                INSERT INTO public.counseling_log_answers (counseling_log_id, question_id, answer_text)
                VALUES (v_log.id, v_q.id, v_log.content);
            END IF;
        END LOOP;
    END LOOP;

    RAISE NOTICE '0032 seed: 행사 D 커스텀 문항 2 + 기존 일지 답변 backfill 완료.';
END $$;

-- =============================================================================
-- 롤백 스니펫 (이 마이그레이션의 dev seed 데이터만 정리)
-- =============================================================================
-- DELETE FROM public.counseling_log_questions
--   WHERE event_id = 'a0000000-0000-4000-8000-000000000004' AND system_key IS NULL;
-- (테이블/트리거/함수 자체를 되돌리려면:
--  DROP TRIGGER event_default_counseling_after_insert ON public.events;
--  DROP FUNCTION public.trg_event_default_counseling();
--  DROP FUNCTION public.ensure_default_counseling_questions(UUID);
--  DROP TABLE public.counseling_log_answers, public.counseling_log_questions CASCADE;)
-- =============================================================================
