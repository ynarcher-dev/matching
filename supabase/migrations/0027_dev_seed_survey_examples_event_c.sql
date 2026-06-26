-- =============================================================================
-- 0027_dev_seed_survey_examples_event_c.sql — 만족도 5유형 예시 문항(행사 C)
-- =============================================================================
-- 목적: 0026 과 동일한 "각 유형별 예시 문항"을 행사 C(FINISHED, 바이오 파트너링데이)
--       에도 반영. 종료 행사라 관리자 빌더에서는 읽기 전용으로 보이고,
--       참가자 포탈(스타트업 로그인) 에서는 실제 입력 위젯으로 렌더된다.
--   - 기존 기본 문항(4 RATING + 1 LONG) 보존, STARTUP 탭에 빠진 3유형 덧붙임,
--     EXPERT 탭 예시 3문항 추가.
--   - 단일 가드(예시 마커 문항)로 재실행 안전.
-- 제거: 맨 아래 롤백 스니펫.
-- =============================================================================

DO $$
DECLARE
    v_event_c UUID := 'a0000000-0000-4000-8000-000000000003'; -- FINISHED
    v_su_max  INT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = v_event_c) THEN
        RAISE NOTICE '0027 seed: 행사 C 없음 — 스킵';
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.survey_questions
        WHERE event_id = v_event_c AND title = '관심 분야 (복수 선택)'
    ) THEN
        RAISE NOTICE '0027 seed: 이미 적용됨 — 스킵';
        RETURN;
    END IF;

    -- 행사 C 에 기본 문항이 없다면 보장(방어적)
    PERFORM public.ensure_default_survey_questions(v_event_c);

    SELECT COALESCE(MAX(order_no), 0) INTO v_su_max
    FROM public.survey_questions
    WHERE event_id = v_event_c AND target_role = 'STARTUP';

    INSERT INTO public.survey_questions
        (event_id, target_role, question_type, title, description, options, is_required, order_no)
    VALUES
        (v_event_c, 'STARTUP', 'SINGLE_CHOICE', '이 행사를 다른 기업에 추천하시겠습니까?',
         '하나만 선택해 주세요.',
         '["적극 추천","추천","보통","비추천"]'::jsonb, TRUE, v_su_max + 1),
        (v_event_c, 'STARTUP', 'MULTIPLE_CHOICE', '관심 분야 (복수 선택)',
         '해당하는 분야를 모두 선택해 주세요.',
         '["바이오","핀테크","친환경","AI","로보틱스"]'::jsonb, FALSE, v_su_max + 2),
        (v_event_c, 'STARTUP', 'SHORT_ANSWER', '가장 인상 깊었던 전문가/세션',
         '한 줄로 적어 주세요.',
         NULL, FALSE, v_su_max + 3);

    INSERT INTO public.survey_questions
        (event_id, target_role, question_type, title, description, options, is_required, order_no)
    VALUES
        (v_event_c, 'EXPERT', 'RATING', '상담 스타트업의 전반적 준비도',
         '1~5점으로 평가해 주세요.', NULL, TRUE, 1),
        (v_event_c, 'EXPERT', 'SINGLE_CHOICE', '후속 미팅 의향',
         '하나만 선택해 주세요.',
         '["있음","검토 중","없음"]'::jsonb, TRUE, 2),
        (v_event_c, 'EXPERT', 'LONG_ANSWER', '상담 총평 및 운영 피드백',
         '자유롭게 작성해 주세요.', NULL, FALSE, 3);

    RAISE NOTICE '0027 seed: 행사 C 예시 문항 적용 완료 (STARTUP +3 유형, EXPERT +3).';
END $$;

-- =============================================================================
-- 롤백 스니펫 (이 예시 시드만 정리)
-- =============================================================================
-- DELETE FROM public.survey_questions
--  WHERE event_id = 'a0000000-0000-4000-8000-000000000003'
--    AND ( (target_role = 'STARTUP' AND title IN (
--            '이 행사를 다른 기업에 추천하시겠습니까?','관심 분야 (복수 선택)','가장 인상 깊었던 전문가/세션'))
--       OR  target_role = 'EXPERT' );
-- =============================================================================
