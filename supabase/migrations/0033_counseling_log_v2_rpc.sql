-- =============================================================================
-- 0033_counseling_log_v2_rpc.sql
--   전문가 상담일지 커스터마이징 슬라이스 B — v2 저장/제출 RPC.
--   동적 문항(counseling_log_questions/answers, 0032) 기반으로 임시저장/최종 제출을
--   처리하고, 최종 제출은 matching_slots.session_status = 'COMPLETED' 전환과 단일
--   트랜잭션으로 묶는다. system_key 문항은 counseling_logs 레거시 컬럼에 동기화한다.
-- 출처: docs/counseling_log_customization.md §5, §9(슬라이스 B), §10
-- -----------------------------------------------------------------------------
-- 레거시 RPC(save_counseling_draft / submit_counseling_log, 0005)는 보존한다.
-- p_answers 형식(jsonb 배열):
--   [{ "question_id": uuid,
--      "answer_rating": 1..5 | null,
--      "answer_text": text | null,
--      "answer_selections": ["..."] | null }, ...]
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 내부 헬퍼 — 동적 답변 검증·저장 + 레거시 컬럼 동기화
--    p_enforce_required = TRUE 면 필수 문항 누락을 차단(최종 제출), FALSE 면 허용(임시저장).
--    답변은 delete-then-insert 로 갱신해 미입력(해제)도 깨끗이 반영한다.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._process_counseling_answers(
    p_log_id     UUID,
    p_event_id   UUID,
    p_answers    JSONB,
    p_enforce_required BOOLEAN
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_q      RECORD;
    v_ans    JSONB;
    v_rating INT;
    v_text   TEXT;
    v_sel    JSONB;
BEGIN
    -- 기존 답변 전량 삭제 후 재삽입(해제/변경 반영). 마스터(counseling_logs)는 유지.
    DELETE FROM public.counseling_log_answers WHERE counseling_log_id = p_log_id;

    FOR v_q IN
        SELECT * FROM public.counseling_log_questions
        WHERE event_id = p_event_id
        ORDER BY order_no
    LOOP
        SELECT a INTO v_ans
        FROM jsonb_array_elements(COALESCE(p_answers, '[]'::jsonb)) AS a
        WHERE (a->>'question_id')::uuid = v_q.id
        LIMIT 1;

        v_rating := NULLIF(v_ans->>'answer_rating', '')::int;
        v_text   := NULLIF(btrim(COALESCE(v_ans->>'answer_text', '')), '');
        v_sel    := v_ans->'answer_selections';

        -- 필수 누락 검사(최종 제출 전용)
        IF p_enforce_required AND v_q.is_required THEN
            IF v_q.question_type = 'RATING' AND v_rating IS NULL THEN
                RAISE EXCEPTION '필수 항목에 응답해 주세요: %', v_q.title;
            ELSIF v_q.question_type IN ('SHORT_ANSWER', 'LONG_ANSWER') AND v_text IS NULL THEN
                RAISE EXCEPTION '필수 항목에 응답해 주세요: %', v_q.title;
            ELSIF v_q.question_type IN ('SINGLE_CHOICE', 'MULTIPLE_CHOICE')
                  AND (v_sel IS NULL OR jsonb_array_length(v_sel) = 0) THEN
                RAISE EXCEPTION '필수 항목에 응답해 주세요: %', v_q.title;
            END IF;
        END IF;

        -- 응답 없는 항목은 저장 건너뜀(임시저장 부분 입력 허용)
        IF v_ans IS NULL THEN
            CONTINUE;
        END IF;

        -- 타입별 형식 검증 + 저장
        IF v_q.question_type = 'RATING' THEN
            IF v_rating IS NOT NULL THEN
                IF v_rating < 1 OR v_rating > 5 THEN
                    RAISE EXCEPTION '평점은 1~5 범위여야 합니다: %', v_q.title;
                END IF;
                INSERT INTO public.counseling_log_answers (counseling_log_id, question_id, answer_rating)
                VALUES (p_log_id, v_q.id, v_rating);
            END IF;

        ELSIF v_q.question_type IN ('SHORT_ANSWER', 'LONG_ANSWER') THEN
            IF v_text IS NOT NULL THEN
                INSERT INTO public.counseling_log_answers (counseling_log_id, question_id, answer_text)
                VALUES (p_log_id, v_q.id, v_text);
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
                INSERT INTO public.counseling_log_answers (counseling_log_id, question_id, answer_selections)
                VALUES (p_log_id, v_q.id, v_sel);
            END IF;
        END IF;
    END LOOP;

    -- 레거시 컬럼 동기화 — system_key 문항의 답변을 counseling_logs 컬럼에 반영.
    -- (기존 화면·list_public_comments(0023)·CSV 가 깨지지 않도록 병행 저장. 문항이 없으면 NULL.)
    UPDATE public.counseling_logs cl SET
        score_technology    = public._clog_sync_rating(p_log_id, p_event_id, 'score_technology'),
        score_expertise     = public._clog_sync_rating(p_log_id, p_event_id, 'score_expertise'),
        score_reliability   = public._clog_sync_rating(p_log_id, p_event_id, 'score_reliability'),
        score_collaboration = public._clog_sync_rating(p_log_id, p_event_id, 'score_collaboration'),
        score_probability   = public._clog_sync_rating(p_log_id, p_event_id, 'score_probability'),
        content             = public._clog_sync_text(p_log_id, p_event_id, 'content')
    WHERE cl.id = p_log_id;
END $$;
REVOKE ALL ON FUNCTION public._process_counseling_answers(UUID, UUID, JSONB, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._process_counseling_answers(UUID, UUID, JSONB, BOOLEAN) FROM anon, authenticated;

-- system_key 문항의 평점/텍스트 답변을 꺼내는 보조 함수(레거시 동기화용).
CREATE OR REPLACE FUNCTION public._clog_sync_rating(p_log_id UUID, p_event_id UUID, p_key TEXT)
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT a.answer_rating
    FROM public.counseling_log_answers a
    JOIN public.counseling_log_questions q ON q.id = a.question_id
    WHERE a.counseling_log_id = p_log_id AND q.event_id = p_event_id AND q.system_key = p_key
    LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public._clog_sync_rating(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._clog_sync_rating(UUID, UUID, TEXT) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._clog_sync_text(p_log_id UUID, p_event_id UUID, p_key TEXT)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT a.answer_text
    FROM public.counseling_log_answers a
    JOIN public.counseling_log_questions q ON q.id = a.question_id
    WHERE a.counseling_log_id = p_log_id AND q.event_id = p_event_id AND q.system_key = p_key
    LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public._clog_sync_text(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._clog_sync_text(UUID, UUID, TEXT) FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. 임시저장 v2 — 점수/답변 부분 입력 허용, 세션 미완료(COMPLETED 전환 없음)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_counseling_log_draft_v2(
    p_slot_id UUID,
    p_answers JSONB,
    p_follow_up_required BOOLEAN DEFAULT FALSE,
    p_follow_up_memo TEXT DEFAULT NULL,
    p_is_public BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_slot public.matching_slots%ROWTYPE;
    v_event_status TEXT;
    v_log_id UUID;
BEGIN
    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id FOR UPDATE;
    IF v_slot.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;
    IF v_slot.expert_id <> v_uid THEN RAISE EXCEPTION '본인 세션의 일지만 작성할 수 있습니다.'; END IF;

    IF v_slot.session_status NOT IN ('WAITING', 'IN_PROGRESS') THEN
        RAISE EXCEPTION '대기/진행 중인 세션만 임시저장할 수 있습니다. (현재: %)', v_slot.session_status;
    END IF;

    SELECT status INTO v_event_status FROM public.events WHERE id = v_slot.event_id;
    IF v_event_status = 'FINISHED' THEN
        RAISE EXCEPTION '종료된 행사에는 상담일지를 저장할 수 없습니다.';
    END IF;

    -- 마스터 행 확보(없으면 생성). 메타 필드(후속/공개)는 여기서 갱신.
    INSERT INTO public.counseling_logs (matching_slot_id, follow_up_required, follow_up_memo, is_public)
    VALUES (p_slot_id, p_follow_up_required, p_follow_up_memo, p_is_public)
    ON CONFLICT (matching_slot_id) DO UPDATE SET
        follow_up_required = EXCLUDED.follow_up_required,
        follow_up_memo = EXCLUDED.follow_up_memo,
        is_public = EXCLUDED.is_public,
        updated_at = now()
    RETURNING id INTO v_log_id;

    PERFORM public._process_counseling_answers(v_log_id, v_slot.event_id, p_answers, FALSE);

    -- session_status 는 변경하지 않는다(임시저장).
    RETURN v_log_id;
END $$;
REVOKE ALL ON FUNCTION public.save_counseling_log_draft_v2(UUID, JSONB, BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_counseling_log_draft_v2(UUID, JSONB, BOOLEAN, TEXT, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_counseling_log_draft_v2(UUID, JSONB, BOOLEAN, TEXT, BOOLEAN) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. 최종 제출 v2 — 필수 문항 검증 + COMPLETED 전환(단일 트랜잭션) + 수정 감사로그
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_counseling_log_v2(
    p_slot_id UUID,
    p_answers JSONB,
    p_follow_up_required BOOLEAN DEFAULT FALSE,
    p_follow_up_memo TEXT DEFAULT NULL,
    p_is_public BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_slot public.matching_slots%ROWTYPE;
    v_event_status TEXT;
    v_existing public.counseling_logs%ROWTYPE;
    v_log_id UUID;
BEGIN
    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id FOR UPDATE;
    IF v_slot.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;
    IF v_slot.expert_id <> v_uid THEN RAISE EXCEPTION '본인 세션의 일지만 작성할 수 있습니다.'; END IF;

    -- 제출 가능한 세션 상태인지 확인(노쇼/취소 슬롯은 제출 불가).
    IF v_slot.session_status NOT IN ('WAITING', 'IN_PROGRESS', 'COMPLETED') THEN
        RAISE EXCEPTION '제출할 수 없는 세션 상태입니다. (현재: %)', v_slot.session_status;
    END IF;

    SELECT status INTO v_event_status FROM public.events WHERE id = v_slot.event_id;
    IF v_event_status = 'FINISHED' THEN
        RAISE EXCEPTION '종료된 행사의 상담일지는 수정할 수 없습니다.';
    END IF;

    SELECT * INTO v_existing FROM public.counseling_logs WHERE matching_slot_id = p_slot_id;

    -- 마스터 행 확보 + 메타 갱신.
    IF v_existing.id IS NULL THEN
        INSERT INTO public.counseling_logs (matching_slot_id, follow_up_required, follow_up_memo, is_public)
        VALUES (p_slot_id, p_follow_up_required, p_follow_up_memo, p_is_public)
        RETURNING id INTO v_log_id;
    ELSE
        v_log_id := v_existing.id;
        -- 이미 COMPLETED 상태에서의 재제출만 '수정'으로 보고 감사 로그를 남긴다.
        IF v_slot.session_status = 'COMPLETED' THEN
            INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, old_values, new_values, reason)
            VALUES (v_uid, 'EDIT_COUNSELING_LOG', 'counseling_logs', v_existing.id,
                to_jsonb(v_existing),
                jsonb_build_object('is_public', p_is_public, 'follow_up_required', p_follow_up_required),
                '상담일지 수정(v2)');
        END IF;
        UPDATE public.counseling_logs SET
            follow_up_required = p_follow_up_required,
            follow_up_memo = p_follow_up_memo,
            is_public = p_is_public,
            updated_at = now()
        WHERE id = v_log_id;
    END IF;

    -- 동적 답변 저장 + 필수 검증 + 레거시 동기화(필수 누락 시 여기서 RAISE → 트랜잭션 롤백).
    PERFORM public._process_counseling_answers(v_log_id, v_slot.event_id, p_answers, TRUE);

    -- 최초 확정: COMPLETED 가 아니면 지금 전환하고 제출 시각 확정.
    IF v_slot.session_status <> 'COMPLETED' THEN
        UPDATE public.matching_slots SET session_status = 'COMPLETED' WHERE id = p_slot_id;
        UPDATE public.counseling_logs SET submitted_at = now() WHERE id = v_log_id;
    END IF;

    RETURN v_log_id;
END $$;
REVOKE ALL ON FUNCTION public.submit_counseling_log_v2(UUID, JSONB, BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_counseling_log_v2(UUID, JSONB, BOOLEAN, TEXT, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_counseling_log_v2(UUID, JSONB, BOOLEAN, TEXT, BOOLEAN) TO authenticated;
