-- =============================================================================
-- 0030_expert_default_survey.sql — 전문가(EXPERT) 대상 기본 만족도 문항 프로비저닝
-- 출처: docs/page_expert_dashboard.md §2.5, docs/page_survey_customization.md (슬라이스 D)
-- =============================================================================
-- 0025 는 STARTUP 기본 문항만 자동 생성했다(ensure_default_survey_questions). 전문가
-- 포탈(Phase 6) FINISHED 단계에서도 만족도 조사를 노출하므로 EXPERT 대상 기본 문항을
-- 같은 패턴으로 제공한다. 행사에 EXPERT 문항이 하나도 없을 때만 채워 멱등(idempotent).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ensure_default_expert_survey_questions(p_event_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.survey_questions
        WHERE event_id = p_event_id AND target_role = 'EXPERT'
    ) THEN
        RETURN;
    END IF;
    INSERT INTO public.survey_questions
        (event_id, target_role, question_type, title, description, options, is_required, order_no)
    VALUES
        (p_event_id, 'EXPERT', 'RATING', '행사 운영 만족도', '행사 운영(안내·진행)에 만족하셨나요?', NULL, TRUE, 1),
        (p_event_id, 'EXPERT', 'RATING', '매칭 적절성', '배정된 스타트업과의 매칭이 적절했나요?', NULL, TRUE, 2),
        (p_event_id, 'EXPERT', 'RATING', '상담 환경 편의성', '상담 공간·일정 등 진행 편의성에 만족하셨나요?', NULL, TRUE, 3),
        (p_event_id, 'EXPERT', 'RATING', '재참여 의향', '다음에도 자문위원으로 참여하실 의향이 있으신가요?', NULL, TRUE, 4),
        (p_event_id, 'EXPERT', 'LONG_ANSWER', '자유 의견', '행사 운영·매칭에 대한 의견을 자유롭게 남겨 주세요.', NULL, FALSE, 5);
END $$;
REVOKE ALL ON FUNCTION public.ensure_default_expert_survey_questions(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_default_expert_survey_questions(UUID) FROM anon;

-- 행사 생성 트리거가 STARTUP + EXPERT 기본 문항을 모두 부여하도록 확장.
CREATE OR REPLACE FUNCTION public.trg_event_default_survey()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public.ensure_default_survey_questions(NEW.id);
    PERFORM public.ensure_default_expert_survey_questions(NEW.id);
    RETURN NEW;
END $$;

-- 기존 행사 전부 backfill(전문가 포탈 노출 시 문항이 존재하도록).
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT id FROM public.events LOOP
        PERFORM public.ensure_default_expert_survey_questions(r.id);
    END LOOP;
END $$;
