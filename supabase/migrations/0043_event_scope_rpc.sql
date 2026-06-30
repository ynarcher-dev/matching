-- =============================================================================
-- 0043_event_scope_rpc.sql — 관리자 RPC 가드 행사 범위화 (부가기능 슬라이스 B-2)
-- 출처: docs/page_admin_operator_permissions.md §5, docs/security_transactions.md 2장,
--       docs/worklog_operator_permissions.md §2.2
-- =============================================================================
-- 목적:
--   SECURITY DEFINER 관리자 RPC 의 전역 가드(`current_app_role() = 'ADMIN'` /
--   `IN ('ADMIN','STAFF')`)를 행사 범위 헬퍼(`can_manage_event`/`can_staff_event`,
--   0039)로 교체한다. event 인자(또는 슬롯/알림 로그에서 도출한 event_id)를 기준으로
--   판단하므로, 일반 운영자는 배정된 행사에서만 해당 동작을 수행할 수 있다.
--
-- 안전장치:
--   * 헬퍼는 `is_super_admin()` 을 무조건 통과시킨다(0039) → 최고관리자는 전 행사
--     접근이 유지되어 무중단.
--   * 헬퍼는 0017 의 NULL-안전 패턴을 유지 → 미매핑 호출자/NULL event_id 는 거부.
--   * 함수 본문은 가드 라인만 교체하고 나머지 로직은 원본(0004/0005/0014/0015/0018/
--     0019/0020/0034) 그대로 재현한다. 실패 메시지도 동일하게 유지한다.
--
-- 범위 제외(전역/별도 정책):
--   * `override_event_status`(0006) — 이미 `is_super_admin()` (상태 강제 변경=최고관리자).
--   * 전역 참가자 디렉터리 RPC(`admin_invalidate_user_sessions` 등) — 전역 정책 확정 후 별도.
--   * `issue_access_code`(0002, 레거시) — 무료 운영 전환으로 비활성 경로.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 예약/배치 (행사 관리 권한: can_manage_event)
-- -----------------------------------------------------------------------------

-- 1.1 관리자 강제 배정 (0004) — 슬롯에서 event_id 도출.
CREATE OR REPLACE FUNCTION public.admin_force_assign(p_slot_id UUID, p_startup_id UUID, p_reason TEXT)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_slot public.matching_slots%ROWTYPE;
    v_prev JSONB;
BEGIN
    IF NOT public.can_manage_event((SELECT event_id FROM public.matching_slots WHERE id = p_slot_id)) THEN
        RAISE EXCEPTION '강제 배정은 관리자만 가능합니다.';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
        RAISE EXCEPTION '강제 배정 사유는 필수입니다.';
    END IF;

    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id FOR UPDATE;
    IF v_slot.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;
    v_prev := public._slot_snapshot(v_slot);

    -- 기존 점유 해제 후 강제 배정 검증(최대횟수 우회)
    IF v_slot.startup_id IS NOT NULL THEN
        UPDATE public.matching_slots SET startup_id = NULL, booking_type = 'NONE' WHERE id = p_slot_id;
        SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id;
    END IF;

    PERFORM public._validate_slot_assignment(v_slot, p_startup_id, TRUE);

    UPDATE public.matching_slots
    SET startup_id = p_startup_id, booking_type = 'ADMIN_FORCE'
    WHERE id = p_slot_id;

    INSERT INTO public.booking_history (matching_slot_id, action_type, actor_id, startup_id, expert_id, previous_slot_info, new_slot_info, reason)
    VALUES (p_slot_id, 'CHANGED', v_uid, p_startup_id, v_slot.expert_id, v_prev,
            public._slot_snapshot((SELECT s FROM public.matching_slots s WHERE s.id = p_slot_id)), p_reason);

    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, old_values, new_values, reason)
    VALUES (v_uid, 'FORCE_ASSIGN', 'matching_slots', p_slot_id, v_prev,
            public._slot_snapshot((SELECT s FROM public.matching_slots s WHERE s.id = p_slot_id)), p_reason);

    RETURN p_slot_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_force_assign(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_force_assign(UUID, UUID, TEXT) TO authenticated;

-- 1.2 관리자 강제 취소 (0014) — 슬롯에서 event_id 도출.
CREATE OR REPLACE FUNCTION public.admin_force_cancel(p_slot_id UUID, p_reason TEXT)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_slot public.matching_slots%ROWTYPE;
    v_prev JSONB;
BEGIN
    IF NOT public.can_manage_event((SELECT event_id FROM public.matching_slots WHERE id = p_slot_id)) THEN
        RAISE EXCEPTION '강제 취소는 관리자만 가능합니다.';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
        RAISE EXCEPTION '강제 취소 사유는 필수입니다.';
    END IF;

    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id FOR UPDATE;
    IF v_slot.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;
    IF v_slot.startup_id IS NULL THEN RAISE EXCEPTION '예약이 없는 슬롯입니다.'; END IF;
    v_prev := public._slot_snapshot(v_slot);

    -- 슬롯 즉시 공개(별도 Hold 없음). 세션 상태는 기본 WAITING 으로 되돌린다.
    UPDATE public.matching_slots
    SET startup_id = NULL, booking_type = 'NONE', session_status = 'WAITING'
    WHERE id = p_slot_id;

    INSERT INTO public.booking_history (matching_slot_id, action_type, actor_id, startup_id, expert_id, previous_slot_info, reason)
    VALUES (p_slot_id, 'CANCELLED', v_uid, v_slot.startup_id, v_slot.expert_id, v_prev, p_reason);

    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, old_values, new_values, reason)
    VALUES (v_uid, 'FORCE_CANCEL', 'matching_slots', p_slot_id, v_prev,
            public._slot_snapshot((SELECT s FROM public.matching_slots s WHERE s.id = p_slot_id)), p_reason);

    RETURN p_slot_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_force_cancel(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_force_cancel(UUID, TEXT) TO authenticated;

-- 1.3 세션 취소 (0005) — 슬롯에서 event_id 도출.
CREATE OR REPLACE FUNCTION public.cancel_session(p_slot_id UUID, p_reason TEXT)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_slot public.matching_slots%ROWTYPE;
BEGIN
    IF NOT public.can_manage_event((SELECT event_id FROM public.matching_slots WHERE id = p_slot_id)) THEN
        RAISE EXCEPTION '세션 취소는 관리자만 가능합니다.';
    END IF;
    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id FOR UPDATE;
    IF v_slot.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;
    IF v_slot.session_status <> 'WAITING' THEN
        RAISE EXCEPTION '대기(WAITING) 상태에서만 세션을 취소할 수 있습니다. (현재: %)', v_slot.session_status;
    END IF;

    UPDATE public.matching_slots SET session_status = 'CANCELLED' WHERE id = p_slot_id;

    INSERT INTO public.booking_history (matching_slot_id, action_type, actor_id, startup_id, expert_id, previous_slot_info, reason)
    VALUES (p_slot_id, 'CANCELLED', v_uid, v_slot.startup_id, v_slot.expert_id, public._slot_snapshot(v_slot), p_reason);
    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, old_values, reason)
    VALUES (v_uid, 'CANCEL_SESSION', 'matching_slots', p_slot_id, public._slot_snapshot(v_slot), p_reason);

    RETURN p_slot_id;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_session(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_session(UUID, TEXT) TO authenticated;

-- 1.4 슬롯 자동 생성 (0015) — p_event_id 직접.
CREATE OR REPLACE FUNCTION public.generate_event_slots(
    p_event_id UUID,
    p_start_time TIMESTAMPTZ,
    p_session_minutes INT,
    p_session_count INT,
    p_break_minutes INT DEFAULT 0,
    p_expert_ids UUID[] DEFAULT NULL,
    p_replace_unbooked BOOLEAN DEFAULT TRUE
)
RETURNS INT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_status TEXT;
    v_created INT := 0;
    v_expert RECORD;
    v_i INT;
    v_start TIMESTAMPTZ;
    v_end TIMESTAMPTZ;
    v_step INT;
BEGIN
    IF NOT public.can_manage_event(p_event_id) THEN
        RAISE EXCEPTION '슬롯 생성은 관리자만 가능합니다.';
    END IF;
    IF p_start_time IS NULL THEN
        RAISE EXCEPTION '시작 시각은 필수입니다.';
    END IF;
    IF p_session_minutes IS NULL OR p_session_minutes <= 0 OR p_session_minutes > 600 THEN
        RAISE EXCEPTION '세션 길이는 1~600분 사이여야 합니다.';
    END IF;
    IF p_session_count IS NULL OR p_session_count <= 0 OR p_session_count > 50 THEN
        RAISE EXCEPTION '세션 횟수는 1~50회 사이여야 합니다.';
    END IF;
    IF p_break_minutes IS NULL OR p_break_minutes < 0 OR p_break_minutes > 600 THEN
        RAISE EXCEPTION '휴식 시간은 0~600분 사이여야 합니다.';
    END IF;

    SELECT status INTO v_status FROM public.events WHERE id = p_event_id AND deleted_at IS NULL;
    IF v_status IS NULL THEN RAISE EXCEPTION '행사를 찾을 수 없습니다.'; END IF;
    IF v_status IN ('PROGRESS', 'FINISHED', 'CANCELLED') THEN
        RAISE EXCEPTION '대기/예약/배치 조율 단계에서만 슬롯을 생성할 수 있습니다. (현재: %)', v_status;
    END IF;

    v_step := p_session_minutes + p_break_minutes;

    -- 대상 전문가: 행사 참가 EXPERT (옵션으로 일부만 한정)
    FOR v_expert IN
        SELECT ep.user_id AS expert_id
        FROM public.event_participants ep
        WHERE ep.event_id = p_event_id
          AND ep.participant_type = 'EXPERT'
          AND (p_expert_ids IS NULL OR ep.user_id = ANY(p_expert_ids))
    LOOP
        -- 재생성: 해당 전문가의 빈 슬롯만 제거(예약/진행 슬롯은 보존). 제안(matching_proposals)은 FK CASCADE.
        IF p_replace_unbooked THEN
            DELETE FROM public.matching_slots s
            WHERE s.event_id = p_event_id
              AND s.expert_id = v_expert.expert_id
              AND s.startup_id IS NULL
              AND s.session_status = 'WAITING';
        END IF;

        FOR v_i IN 0..(p_session_count - 1) LOOP
            v_start := p_start_time + make_interval(mins => v_i * v_step);
            v_end := v_start + make_interval(mins => p_session_minutes);

            -- 같은 전문가의 보존된 슬롯과 시간이 겹치면 건너뛴다(중복/충돌 방지).
            IF EXISTS (
                SELECT 1 FROM public.matching_slots s
                WHERE s.event_id = p_event_id
                  AND s.expert_id = v_expert.expert_id
                  AND s.session_status <> 'CANCELLED'
                  AND s.start_time < v_end AND s.end_time > v_start
            ) THEN
                CONTINUE;
            END IF;

            INSERT INTO public.matching_slots
                (event_id, expert_id, start_time, end_time, booking_type, session_status)
            VALUES (p_event_id, v_expert.expert_id, v_start, v_end, 'NONE', 'WAITING');
            v_created := v_created + 1;
        END LOOP;
    END LOOP;

    RETURN v_created;
END;
$$;
REVOKE ALL ON FUNCTION public.generate_event_slots(UUID, TIMESTAMPTZ, INT, INT, INT, UUID[], BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_event_slots(UUID, TIMESTAMPTZ, INT, INT, INT, UUID[], BOOLEAN) TO authenticated;

-- 1.5 빈 슬롯 초기화 (0015) — p_event_id 직접.
CREATE OR REPLACE FUNCTION public.clear_unbooked_slots(p_event_id UUID)
RETURNS INT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_status TEXT;
    v_deleted INT;
BEGIN
    IF NOT public.can_manage_event(p_event_id) THEN
        RAISE EXCEPTION '슬롯 초기화는 관리자만 가능합니다.';
    END IF;

    SELECT status INTO v_status FROM public.events WHERE id = p_event_id AND deleted_at IS NULL;
    IF v_status IS NULL THEN RAISE EXCEPTION '행사를 찾을 수 없습니다.'; END IF;
    IF v_status IN ('PROGRESS', 'FINISHED', 'CANCELLED') THEN
        RAISE EXCEPTION '대기/예약/배치 조율 단계에서만 슬롯을 초기화할 수 있습니다. (현재: %)', v_status;
    END IF;

    DELETE FROM public.matching_slots s
    WHERE s.event_id = p_event_id
      AND s.startup_id IS NULL
      AND s.session_status = 'WAITING';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_unbooked_slots(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_unbooked_slots(UUID) TO authenticated;

-- 1.6 AI 제안 생성 (0018) — p_event_id 직접.
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
    IF NOT public.can_manage_event(p_event_id) THEN
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

-- 1.7 AI 제안 확정 (0018) — p_event_id 직접.
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
    IF NOT public.can_manage_event(p_event_id) THEN
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

-- -----------------------------------------------------------------------------
-- 2. 출석/노쇼 (현장 권한: can_staff_event — STAFF 이상)
-- -----------------------------------------------------------------------------

-- 2.1 노쇼 처리 (0005) — 출석 성격이므로 can_staff_event. 슬롯에서 event_id 도출.
CREATE OR REPLACE FUNCTION public.mark_no_show(p_slot_id UUID, p_reason TEXT)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_slot public.matching_slots%ROWTYPE;
BEGIN
    IF NOT public.can_staff_event((SELECT event_id FROM public.matching_slots WHERE id = p_slot_id)) THEN
        RAISE EXCEPTION '노쇼 처리는 관리자만 가능합니다.';
    END IF;
    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id FOR UPDATE;
    IF v_slot.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;
    IF v_slot.session_status NOT IN ('WAITING', 'IN_PROGRESS') THEN
        RAISE EXCEPTION '대기/진행 상태에서만 노쇼 처리할 수 있습니다. (현재: %)', v_slot.session_status;
    END IF;

    UPDATE public.matching_slots SET session_status = 'NO_SHOW' WHERE id = p_slot_id;

    INSERT INTO public.booking_history (matching_slot_id, action_type, actor_id, startup_id, expert_id, previous_slot_info, reason)
    VALUES (p_slot_id, 'NO_SHOW', v_uid, v_slot.startup_id, v_slot.expert_id, public._slot_snapshot(v_slot), p_reason);
    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, old_values, reason)
    VALUES (v_uid, 'MARK_NO_SHOW', 'matching_slots', p_slot_id, public._slot_snapshot(v_slot), p_reason);

    RETURN p_slot_id;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_no_show(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_no_show(UUID, TEXT) TO authenticated;

-- 2.2 출석 체크 (0019 기준) — 전역 ADMIN/STAFF 분기를 can_staff_event(슬롯 event_id)로.
--     전문가 본인 셀프 체크·담당 전문가의 스타트업 체크 경로는 그대로 유지.
CREATE OR REPLACE FUNCTION public.check_in(
    p_slot_id UUID,
    p_user_id UUID,
    p_role_type TEXT,
    p_attendance_status TEXT DEFAULT 'PRESENT',
    p_check_in_type TEXT DEFAULT 'QR',
    p_reason TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_role TEXT := public.current_app_role();
    v_slot public.matching_slots%ROWTYPE;
    v_att_id UUID;
BEGIN
    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id;
    IF v_slot.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;

    IF p_role_type = 'EXPERT' THEN
        -- 전문가 출석: 본인 또는 행사 현장 권한(STAFF 이상). 대상은 반드시 해당 슬롯의 전문가.
        IF v_slot.expert_id <> p_user_id THEN
            RAISE EXCEPTION '해당 슬롯의 전문가가 아닙니다.';
        END IF;
        IF NOT (v_uid = p_user_id OR public.can_staff_event(v_slot.event_id)) THEN
            RAISE EXCEPTION '전문가 출석은 본인 또는 관리자/스태프만 처리할 수 있습니다.';
        END IF;
    ELSIF p_role_type = 'STARTUP' THEN
        -- 스타트업 출석은 행사 현장 권한(STAFF 이상)이 기본 처리.
        -- 단, 해당 슬롯 담당 전문가는 본인 대시보드 세션 카드에서 직접 확인·체크 가능.
        IF NOT (public.can_staff_event(v_slot.event_id) OR (v_role = 'EXPERT' AND v_slot.expert_id = v_uid)) THEN
            RAISE EXCEPTION '스타트업 출석은 관리자/스태프 또는 담당 전문가만 처리할 수 있습니다.';
        END IF;
        IF v_slot.startup_id <> p_user_id THEN
            RAISE EXCEPTION '해당 슬롯의 스타트업이 아닙니다.';
        END IF;
    ELSE
        RAISE EXCEPTION '잘못된 역할 유형입니다.';
    END IF;

    -- 수동 변경(오등록 수정)은 사유 필수
    IF p_check_in_type = 'MANUAL' AND (p_reason IS NULL OR length(btrim(p_reason)) = 0) THEN
        RAISE EXCEPTION '수동 출석 처리는 사유가 필요합니다.';
    END IF;

    INSERT INTO public.attendance_logs (matching_slot_id, user_id, role_type, attendance_status, check_in_type, checked_in_by, reason)
    VALUES (p_slot_id, p_user_id, p_role_type, p_attendance_status, p_check_in_type, v_uid, p_reason)
    RETURNING id INTO v_att_id;

    RETURN v_att_id;
END;
$$;
REVOKE ALL ON FUNCTION public.check_in(UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_in(UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- 2.3 출석 기록 삭제(미정 복귀) (0020 기준) — check_in 과 동일 권한 규칙.
CREATE OR REPLACE FUNCTION public.clear_attendance(
    p_slot_id UUID,
    p_user_id UUID,
    p_role_type TEXT
)
RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
    v_role TEXT := public.current_app_role();
    v_slot public.matching_slots%ROWTYPE;
BEGIN
    SELECT * INTO v_slot FROM public.matching_slots WHERE id = p_slot_id;
    IF v_slot.id IS NULL THEN RAISE EXCEPTION '슬롯을 찾을 수 없습니다.'; END IF;

    IF p_role_type = 'EXPERT' THEN
        IF v_slot.expert_id <> p_user_id THEN
            RAISE EXCEPTION '해당 슬롯의 전문가가 아닙니다.';
        END IF;
        IF NOT (v_uid = p_user_id OR public.can_staff_event(v_slot.event_id)) THEN
            RAISE EXCEPTION '전문가 출석은 본인 또는 관리자/스태프만 처리할 수 있습니다.';
        END IF;
    ELSIF p_role_type = 'STARTUP' THEN
        IF NOT (public.can_staff_event(v_slot.event_id) OR (v_role = 'EXPERT' AND v_slot.expert_id = v_uid)) THEN
            RAISE EXCEPTION '스타트업 출석은 관리자/스태프 또는 담당 전문가만 처리할 수 있습니다.';
        END IF;
        IF v_slot.startup_id <> p_user_id THEN
            RAISE EXCEPTION '해당 슬롯의 스타트업이 아닙니다.';
        END IF;
    ELSE
        RAISE EXCEPTION '잘못된 역할 유형입니다.';
    END IF;

    DELETE FROM public.attendance_logs
    WHERE matching_slot_id = p_slot_id
      AND user_id = p_user_id
      AND role_type = p_role_type;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_attendance(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_attendance(UUID, UUID, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. 알림 (행사 관리 권한: can_manage_event — 알림 로그에서 event_id 도출)
-- -----------------------------------------------------------------------------

-- 3.1 알림 수동 재시도 (0034) — notification_logs.event_id 로 행사 범위 판단.
CREATE OR REPLACE FUNCTION public.retry_notification(p_id UUID)
RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid UUID := public.current_app_user_id();
BEGIN
    IF NOT public.can_manage_event((SELECT event_id FROM public.notification_logs WHERE id = p_id)) THEN
        RAISE EXCEPTION '알림 재시도는 관리자만 가능합니다.';
    END IF;

    UPDATE public.notification_logs
    SET status = 'PENDING', retry_count = 0, next_retry_at = NULL,
        error_message = NULL, updated_at = now()
    WHERE id = p_id AND status = 'FAILED';

    IF NOT FOUND THEN
        RAISE EXCEPTION '재시도할 수 없는 알림입니다(영구 실패 상태만 재시도 가능).';
    END IF;

    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id)
    VALUES (v_uid, 'RETRY_NOTIFICATION', 'notification_logs', p_id);

    RETURN p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.retry_notification(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.retry_notification(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.retry_notification(UUID) TO authenticated;
