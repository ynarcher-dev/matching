-- =============================================================================
-- 0018_ai_allocation.sql — AI 자동배치 제안 생성 / 부분 확정 RPC
-- 출처: docs/page_admin_ai_allocation.md §1~2, docs/db_schema.md §2.12 matching_proposals
-- =============================================================================
-- 잔여(미예약) 스타트업을 빈 타임 슬롯에 그리디(랜덤 없음·결정적)로 임시 배정하고
-- 결과를 matching_proposals 에만 저장한다(실제 matching_slots 는 변경하지 않음).
-- 관리자가 검토 후 confirm_ai_proposals 로 부분/전체 확정하면 matching_slots 에 반영된다.
-- 두 함수 모두 관리자 전용(센티넬 가드: 0017 이후 'NONE' <> 'ADMIN' 으로 NULL 우회 차단).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 제안 생성 (그리디·결정적) → matching_proposals 저장
-- -----------------------------------------------------------------------------
-- 스코어 규칙(결정적, 표시·정렬용):
--   기본 70 + 분야 적합 25 + 0회 배정 우선 5  ⇒ 분야적합·0회=100, 분야적합·기예약=95,
--   분야불일치·0회=75, 분야불일치·기예약=70.
-- 그리디 정렬: 기존 세션 수 ASC(0회 우선) → 분야 적합 DESC → 시작시각 → id(결정적 tiebreak).
-- 제약: 슬롯 1개 1배정, 스타트업 최대 상담 횟수, 스타트업 동시간 충돌(타 행사 포함).
--   (전문가 동시간 충돌은 전문가별 그리드가 서로 겹치지 않으므로 구조적으로 발생 불가.
--    테이블 충돌 등 잔여 정합성은 확정 단계 _validate_slot_assignment 가 최종 검증한다.)
-- is_locked=TRUE 제안은 재계산 시 보존하며 해당 슬롯/스타트업은 점유로 취급한다.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.generate_ai_proposals(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_status TEXT;
    v_max INT;
    v_locked INT;
    v_matched INT := 0;
    v_unmatched INT := 0;
    v_empty_total INT;
    v_pair RECORD;
    v_su RECORD;
    v_count INT;
    v_score NUMERIC(6,2);
    v_reason TEXT;
BEGIN
    IF public.current_app_role() IS DISTINCT FROM 'ADMIN' THEN
        RAISE EXCEPTION 'AI 자동배치는 관리자만 가능합니다.';
    END IF;

    SELECT status, max_sessions_per_startup INTO v_status, v_max
    FROM public.events WHERE id = p_event_id AND deleted_at IS NULL;
    IF v_status IS NULL THEN RAISE EXCEPTION '행사를 찾을 수 없습니다.'; END IF;
    IF v_status <> 'ALLOCATION' THEN
        RAISE EXCEPTION 'AI 자동배치는 배치 조율(ALLOCATION) 단계에서만 가능합니다. (현재: %)', v_status;
    END IF;

    -- 잠금되지 않은 기존 제안만 제거(관리자가 잠근 제안은 보존).
    DELETE FROM public.matching_proposals
    WHERE event_id = p_event_id AND is_locked = FALSE;
    SELECT count(*) INTO v_locked
    FROM public.matching_proposals WHERE event_id = p_event_id AND is_locked;

    -- 참가자 분야 집합(행사 분야 우선, 없으면 사용자 기본 분야) — 분야 적합도 계산용.
    CREATE TEMP TABLE _eff_fields ON COMMIT DROP AS
    SELECT ep.user_id,
           COALESCE(
               NULLIF(
                   ARRAY(SELECT epf.field_id FROM public.event_participant_fields epf
                         WHERE epf.event_participant_id = ep.id),
                   '{}'::uuid[]),
               ARRAY(SELECT uf.field_id FROM public.user_fields uf WHERE uf.user_id = ep.user_id)
           ) AS field_ids
    FROM public.event_participants ep
    WHERE ep.event_id = p_event_id;

    -- 잔여(빈) 슬롯 스냅샷: 미예약·대기 + 잠금 제안이 선점하지 않은 슬롯.
    CREATE TEMP TABLE _empty_slots ON COMMIT DROP AS
    SELECT s.id AS slot_id, s.expert_id, s.start_time, s.end_time
    FROM public.matching_slots s
    WHERE s.event_id = p_event_id
      AND s.startup_id IS NULL
      AND s.session_status = 'WAITING'
      AND NOT EXISTS (
          SELECT 1 FROM public.matching_proposals mp WHERE mp.target_slot_id = s.id
      );
    SELECT count(*) INTO v_empty_total FROM _empty_slots;

    -- 후보 (스타트업 × 빈 슬롯): 최대 횟수 미만인 스타트업만, 점수·정렬 키 동봉.
    CREATE TEMP TABLE _pairs ON COMMIT DROP AS
    SELECT
        st.user_id AS startup_id,
        es.slot_id,
        es.expert_id,
        es.start_time,
        es.end_time,
        (COALESCE(stf.field_ids, '{}'::uuid[]) && COALESCE(exf.field_ids, '{}'::uuid[])) AS field_matched,
        booked.cnt AS existing_count
    FROM (
        SELECT ep.user_id
        FROM public.event_participants ep
        WHERE ep.event_id = p_event_id AND ep.participant_type = 'STARTUP'
    ) st
    JOIN LATERAL (
        SELECT count(*)::int AS cnt
        FROM public.matching_slots ms
        WHERE ms.event_id = p_event_id AND ms.startup_id = st.user_id
          AND ms.session_status <> 'CANCELLED'
    ) booked ON TRUE
    CROSS JOIN _empty_slots es
    LEFT JOIN _eff_fields stf ON stf.user_id = st.user_id
    LEFT JOIN _eff_fields exf ON exf.user_id = es.expert_id
    WHERE booked.cnt < v_max;

    -- 그리디 배정: 결정적 순서로 순회하며 제약을 통과하면 제안을 INSERT 한다.
    FOR v_pair IN
        SELECT * FROM _pairs
        ORDER BY existing_count ASC, field_matched DESC, start_time ASC, startup_id ASC, slot_id ASC
    LOOP
        -- 슬롯이 이번 라운드에 이미 점유되었는지(앞선 제안이 선점).
        IF EXISTS (
            SELECT 1 FROM public.matching_proposals mp WHERE mp.target_slot_id = v_pair.slot_id
        ) THEN CONTINUE; END IF;

        -- 스타트업 현재 세션 수(실예약 + 이번 라운드 제안) >= 최대 횟수.
        SELECT
            (SELECT count(*) FROM public.matching_slots ms
              WHERE ms.event_id = p_event_id AND ms.startup_id = v_pair.startup_id
                AND ms.session_status <> 'CANCELLED')
          + (SELECT count(*) FROM public.matching_proposals mp
              JOIN public.matching_slots ms2 ON ms2.id = mp.target_slot_id
              WHERE mp.event_id = p_event_id AND mp.startup_id = v_pair.startup_id)
        INTO v_count;
        IF v_count >= v_max THEN CONTINUE; END IF;

        -- 스타트업 동시간 충돌(타 행사 포함): 실예약 또는 기존 제안과 시간 겹침.
        IF EXISTS (
            SELECT 1 FROM public.matching_slots ms
            WHERE ms.startup_id = v_pair.startup_id AND ms.session_status <> 'CANCELLED'
              AND ms.start_time < v_pair.end_time AND ms.end_time > v_pair.start_time
        ) OR EXISTS (
            SELECT 1 FROM public.matching_proposals mp
            JOIN public.matching_slots ms2 ON ms2.id = mp.target_slot_id
            WHERE mp.startup_id = v_pair.startup_id
              AND ms2.start_time < v_pair.end_time AND ms2.end_time > v_pair.start_time
        ) THEN CONTINUE; END IF;

        v_score := 70
                 + (CASE WHEN v_pair.field_matched THEN 25 ELSE 0 END)
                 + (CASE WHEN v_pair.existing_count = 0 THEN 5 ELSE 0 END);

        INSERT INTO public.matching_proposals
            (event_id, target_slot_id, startup_id, score, field_matched, unmatched_reason, is_locked)
        VALUES (p_event_id, v_pair.slot_id, v_pair.startup_id, v_score, v_pair.field_matched, NULL, FALSE);
        v_matched := v_matched + 1;
    END LOOP;

    -- 미배치 스타트업: 실예약·제안이 모두 0건인 참가 스타트업에 사유를 남긴다.
    FOR v_su IN
        SELECT ep.user_id
        FROM public.event_participants ep
        WHERE ep.event_id = p_event_id AND ep.participant_type = 'STARTUP'
          AND NOT EXISTS (
              SELECT 1 FROM public.matching_slots ms
              WHERE ms.event_id = p_event_id AND ms.startup_id = ep.user_id
                AND ms.session_status <> 'CANCELLED')
          AND NOT EXISTS (
              SELECT 1 FROM public.matching_proposals mp
              WHERE mp.event_id = p_event_id AND mp.startup_id = ep.user_id
                AND mp.target_slot_id IS NOT NULL)
    LOOP
        IF v_empty_total = 0 THEN
            v_reason := '슬롯 부족';
        ELSIF NOT EXISTS (
            -- 시간 충돌 없이 들어갈 수 있었던 빈 슬롯이 애초에 하나도 없었는가.
            SELECT 1 FROM _empty_slots es
            WHERE NOT EXISTS (
                SELECT 1 FROM public.matching_slots ms
                WHERE ms.startup_id = v_su.user_id AND ms.session_status <> 'CANCELLED'
                  AND ms.start_time < es.end_time AND ms.end_time > es.start_time)
        ) THEN
            v_reason := '시간 충돌';
        ELSE
            -- 빈 슬롯은 있었으나 다른 스타트업에 우선 배정되어 소진됨.
            v_reason := '슬롯 부족';
        END IF;

        INSERT INTO public.matching_proposals
            (event_id, target_slot_id, startup_id, score, field_matched, unmatched_reason, is_locked)
        VALUES (p_event_id, NULL, v_su.user_id, 0, FALSE, v_reason, FALSE);
        v_unmatched := v_unmatched + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'matched', v_matched,
        'unmatched', v_unmatched,
        'locked', v_locked,
        'empty_slots', v_empty_total
    );
END;
$$;
REVOKE ALL ON FUNCTION public.generate_ai_proposals(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_ai_proposals(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. 제안 확정(부분 확정) → matching_slots 반영, 충돌은 제외하고 리포트
-- -----------------------------------------------------------------------------
-- p_proposal_ids = NULL 이면 매칭된 전체 제안을, 배열이면 해당 제안만 확정한다.
-- 각 제안을 서브트랜잭션으로 처리해 _validate_slot_assignment 위반 시 그 건만 건너뛰고
-- 사유를 conflicts 배열에 모은다(정상 건은 그대로 반영). booking_type 은 'AUTO_AI'.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.confirm_ai_proposals(
    p_event_id UUID,
    p_proposal_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_status TEXT;
    v_applied INT := 0;
    v_skipped INT := 0;
    v_conflicts JSONB := '[]'::jsonb;
    v_p RECORD;
    v_slot public.matching_slots%ROWTYPE;
BEGIN
    IF public.current_app_role() IS DISTINCT FROM 'ADMIN' THEN
        RAISE EXCEPTION '제안 확정은 관리자만 가능합니다.';
    END IF;

    SELECT status INTO v_status FROM public.events WHERE id = p_event_id AND deleted_at IS NULL;
    IF v_status IS NULL THEN RAISE EXCEPTION '행사를 찾을 수 없습니다.'; END IF;
    IF v_status <> 'ALLOCATION' THEN
        RAISE EXCEPTION '제안 확정은 배치 조율(ALLOCATION) 단계에서만 가능합니다. (현재: %)', v_status;
    END IF;

    FOR v_p IN
        SELECT mp.id, mp.target_slot_id, mp.startup_id
        FROM public.matching_proposals mp
        WHERE mp.event_id = p_event_id
          AND mp.target_slot_id IS NOT NULL
          AND (p_proposal_ids IS NULL OR mp.id = ANY(p_proposal_ids))
        ORDER BY mp.created_at ASC, mp.id ASC
    LOOP
        BEGIN
            SELECT * INTO v_slot FROM public.matching_slots WHERE id = v_p.target_slot_id FOR UPDATE;
            IF v_slot.id IS NULL THEN
                RAISE EXCEPTION '대상 슬롯이 존재하지 않습니다.';
            END IF;
            IF v_slot.startup_id IS NOT NULL THEN
                RAISE EXCEPTION '대상 슬롯이 이미 예약되어 있습니다.';
            END IF;

            PERFORM public._validate_slot_assignment(v_slot, v_p.startup_id, FALSE);

            UPDATE public.matching_slots
            SET startup_id = v_p.startup_id, booking_type = 'AUTO_AI'
            WHERE id = v_slot.id;

            INSERT INTO public.booking_history
                (matching_slot_id, action_type, actor_id, startup_id, expert_id, new_slot_info, reason)
            VALUES (v_slot.id, 'CREATED', v_uid, v_p.startup_id, v_slot.expert_id,
                    public._slot_snapshot((SELECT s FROM public.matching_slots s WHERE s.id = v_slot.id)),
                    'AI 자동배치 확정');

            DELETE FROM public.matching_proposals WHERE id = v_p.id;
            v_applied := v_applied + 1;
        EXCEPTION WHEN OTHERS THEN
            -- 이 제안만 롤백되고 다음 제안으로 진행(부분 확정). 사유를 리포트에 모은다.
            v_skipped := v_skipped + 1;
            v_conflicts := v_conflicts || jsonb_build_object(
                'proposal_id', v_p.id,
                'startup_id', v_p.startup_id,
                'slot_id', v_p.target_slot_id,
                'reason', SQLERRM
            );
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'applied', v_applied,
        'skipped', v_skipped,
        'conflicts', v_conflicts
    );
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_ai_proposals(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_ai_proposals(UUID, UUID[]) TO authenticated;
