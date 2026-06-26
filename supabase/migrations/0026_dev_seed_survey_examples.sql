-- =============================================================================
-- 0026_dev_seed_survey_examples.sql — 만족도 조사 "각 유형별 예시 문항" 더미 시드
-- =============================================================================
-- 목적: 관리자 빌더(행사 상세 → 만족도 설정 탭)에서 5가지 답변 유형
--       (RATING / SINGLE_CHOICE / MULTIPLE_CHOICE / SHORT_ANSWER / LONG_ANSWER)이
--       실제로 어떻게 보이는지 눈으로 확인하기 위한 임시 시드.
--   - 대상: 행사 A(BOOKING, 편집 가능 단계) — 0016 의 메인 데모 행사.
--   - 기존 기본 문항(자동 프로비저닝 4 RATING + 1 LONG)은 보존하고, 빠진 유형
--     (SINGLE/MULTIPLE_CHOICE, SHORT_ANSWER)을 STARTUP 탭에 덧붙이고,
--     EXPERT 탭에도 예시 3문항을 넣어 두 탭 모두 채운다.
--   - 단일 가드(예시 마커 문항 존재)로 재실행 안전(idempotent).
-- 제거: 맨 아래 롤백 스니펫.
-- =============================================================================

DO $$
DECLARE
    v_event_a UUID := 'a0000000-0000-4000-8000-000000000001'; -- BOOKING
    v_su_max  INT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = v_event_a) THEN
        RAISE NOTICE '0026 seed: 행사 A 없음 — 스킵';
        RETURN;
    END IF;

    -- 가드: 예시 마커 문항이 이미 있으면 스킵
    IF EXISTS (
        SELECT 1 FROM public.survey_questions
        WHERE event_id = v_event_a AND title = '관심 분야 (복수 선택)'
    ) THEN
        RAISE NOTICE '0026 seed: 이미 적용됨 — 스킵';
        RETURN;
    END IF;

    -- STARTUP 탭: 기존 기본 문항 뒤 order_no 부터 빠진 유형을 덧붙인다.
    SELECT COALESCE(MAX(order_no), 0) INTO v_su_max
    FROM public.survey_questions
    WHERE event_id = v_event_a AND target_role = 'STARTUP';

    INSERT INTO public.survey_questions
        (event_id, target_role, question_type, title, description, options, is_required, order_no)
    VALUES
        (v_event_a, 'STARTUP', 'SINGLE_CHOICE', '이 행사를 다른 기업에 추천하시겠습니까?',
         '하나만 선택해 주세요.',
         '["적극 추천","추천","보통","비추천"]'::jsonb, TRUE, v_su_max + 1),
        (v_event_a, 'STARTUP', 'MULTIPLE_CHOICE', '관심 분야 (복수 선택)',
         '해당하는 분야를 모두 선택해 주세요.',
         '["바이오","핀테크","친환경","AI","로보틱스"]'::jsonb, FALSE, v_su_max + 2),
        (v_event_a, 'STARTUP', 'SHORT_ANSWER', '가장 인상 깊었던 전문가/세션',
         '한 줄로 적어 주세요.',
         NULL, FALSE, v_su_max + 3);

    -- EXPERT 탭: 예시 3문항(전문가용 설문은 Phase 6 노출 예정이나, 빌더 확인용 더미)
    INSERT INTO public.survey_questions
        (event_id, target_role, question_type, title, description, options, is_required, order_no)
    VALUES
        (v_event_a, 'EXPERT', 'RATING', '상담 스타트업의 전반적 준비도',
         '1~5점으로 평가해 주세요.', NULL, TRUE, 1),
        (v_event_a, 'EXPERT', 'SINGLE_CHOICE', '후속 미팅 의향',
         '하나만 선택해 주세요.',
         '["있음","검토 중","없음"]'::jsonb, TRUE, 2),
        (v_event_a, 'EXPERT', 'LONG_ANSWER', '상담 총평 및 운영 피드백',
         '자유롭게 작성해 주세요.', NULL, FALSE, 3);

    RAISE NOTICE '0026 seed: 행사 A 예시 문항 적용 완료 (STARTUP +3 유형, EXPERT +3).';
END $$;

-- =============================================================================
-- 롤백 스니펫 (이 예시 시드만 정리)
-- =============================================================================
-- DELETE FROM public.survey_questions
--  WHERE event_id = 'a0000000-0000-4000-8000-000000000001'
--    AND ( (target_role = 'STARTUP' AND title IN (
--            '이 행사를 다른 기업에 추천하시겠습니까?','관심 분야 (복수 선택)','가장 인상 깊었던 전문가/세션'))
--       OR  target_role = 'EXPERT' );
-- =============================================================================
