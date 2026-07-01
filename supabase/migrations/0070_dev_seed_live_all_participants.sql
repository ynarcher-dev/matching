-- =============================================================================
-- 0070_dev_seed_live_all_participants.sql
--   "오늘자 기준 진행중(LIVE) 행사 — 현재 DB의 모든 참가자 전원 등록 + 최대 케이스 변주"
-- =============================================================================
-- 목적: 사용자가 "지금 DB에 들어있는 참가자가 모두 참가하는, 오늘 진행 중인 행사 1건"을
--       개설해 화면 곳곳(진행 현황 대시보드·전문가 대시보드·예약 현황·상담일지 결과·
--       만족도·출석·테이블 담당자·행사 운영자·알림 정책 등)에서 다양한 케이스가 어떻게
--       보이는지 한 번에 확인할 수 있게 한다.
--
-- 설계 원칙 (dev_seed_convention.md 준수):
--   • 데이터 주도: 특정 시드 UUID 를 하드코딩하지 않고, "적용 시점의 DB 에 존재하는
--     모든 EXPERT · 모든 STARTUP" 을 동적으로 참가자로 등록한다 → 전원 참가 보장.
--   • 그리드는 적용 시점 now() 기준. status_override=TRUE 로 PROGRESS 고정(Cron 이 FINISHED 로
--     넘기지 않게). 세션 상태를 시간대별로 변주해 완료/진행중/대기/불참/취소/빈슬롯 을 모두 노출.
--   • RPC 우회 직접 INSERT(마이그레이션 = 테이블 owner, RLS·가드 우회).
--   • 단일 가드(행사 F 존재)로 재실행 안전(idempotent). 하단 롤백 스니펫 제공.
--
-- ⚠ 알림 트리거 주의: booking_history INSERT 시 trg_notify_booking → _enqueue_notification
--   이 호출된다. 이 함수는 정책=NONE 또는 해당 send_* 토글=OFF 이면 안전하게 RETURN 한다.
--   (현 스키마의 notification_logs 에는 channel/destination 컬럼이 없어, 정책이 켜진 채
--   토글이 ON 이면 INSERT 가 실패한다 — 잠재버그.) 따라서 이 시드는 행사별 알림 설정 행을
--   넣되 모든 send_* 토글을 FALSE 로 유지해 그 경로를 절대 타지 않게 한다.
-- =============================================================================

DO $$
DECLARE
    v_event   UUID := 'a0000000-0000-4000-8000-000000000006'; -- LIVE 전원참가 행사(F)
    v_base    TIMESTAMPTZ := now() - interval '125 minutes';   -- 세션 t=0 시작 기준점
    v_stride  INT := 50;   -- 40분 상담 + 10분 휴식
    v_dur     INT := 40;
    v_experts UUID[];
    v_tables  UUID[];
    v_startups UUID[];
    v_e INT;  -- 전문가 수
    v_s INT;  -- 스타트업 수
    v_pool INT; -- 실제 예약에 쓰는 스타트업 풀 크기(끝의 몇 개는 미예약으로 남김)
    v_admin UUID; -- 테이블 담당자/운영자/상태변경자로 쓸 관리자(있으면)
    e_idx INT;
    t_idx INT;
    v_expert UUID;
    v_table UUID;
    v_startup UUID;
    v_status TEXT;
    v_btype TEXT;
    v_start TIMESTAMPTZ;
    v_end TIMESTAMPTZ;
    v_p INT;
BEGIN
    -- ---- 가드: 이미 적용되었으면 전체 스킵 ------------------------------------
    IF EXISTS (SELECT 1 FROM public.events WHERE id = v_event) THEN
        RAISE NOTICE '0070_dev_seed_live_all_participants: 이미 적용됨 — 스킵합니다.';
        RETURN;
    END IF;

    -- ---- 현재 DB 의 전문가/스타트업 로스터 수집(이메일 순 결정적) ------------
    SELECT array_agg(id ORDER BY email) INTO v_experts
      FROM public.users WHERE role = 'EXPERT' AND deleted_at IS NULL;
    SELECT array_agg(id ORDER BY email) INTO v_startups
      FROM public.users WHERE role = 'STARTUP' AND deleted_at IS NULL;

    v_e := coalesce(array_length(v_experts, 1), 0);
    v_s := coalesce(array_length(v_startups, 1), 0);

    IF v_e = 0 OR v_s = 0 THEN
        RAISE EXCEPTION '0070: 전문가(%) 또는 스타트업(%) 이 DB 에 없습니다. 먼저 시드(0016/0053 등)를 적용하세요.', v_e, v_s;
    END IF;

    -- 관리자(테이블 담당자·운영자용). 없으면 NULL 로 두고 관련 시드는 건너뜀.
    SELECT id INTO v_admin
      FROM public.users
     WHERE role IN ('ADMIN', 'STAFF') AND deleted_at IS NULL
     ORDER BY (role = 'ADMIN') DESC, created_at
     LIMIT 1;

    -- 예약 풀: DB 가 충분히 크면 끝 3개 스타트업은 "미예약" 케이스로 남긴다.
    v_pool := CASE WHEN v_s >= v_e + 3 THEN v_s - 3 ELSE v_s END;

    RAISE NOTICE '0070: 로스터 — 전문가 %명 / 스타트업 %명(예약풀 %) / 관리자 %',
                 v_e, v_s, v_pool, coalesce(v_admin::text, '없음');

    -- =========================================================================
    -- 1. 진행 행사 (status_override 로 PROGRESS 고정, now() 가 행사 창에 포함)
    --    만족도 정책 BOTH(행사+전문가 둘 다) 로 두어 만족도 화면 변주 확보.
    -- =========================================================================
    INSERT INTO public.events
        (id, title, status, status_override, status_override_reason,
         status_overridden_at, status_overridden_by,
         booking_start, booking_end, event_start, event_end,
         max_sessions_per_startup, allow_startup_self_booking,
         allow_duplicate_expert, satisfaction_policy)
    VALUES
        (v_event,
         '2026 와이엔아처 통합 매칭데이 (전원참가 · LIVE)',
         'PROGRESS', TRUE, '개발용 시드: 진행 현황 확인을 위한 상태 고정',
         now(), v_admin,
         now() - interval '20 days', now() - interval '1 day',
         now() - interval '2 hours', now() + interval '8 hours',
         3, FALSE, FALSE, 'BOTH');

    -- =========================================================================
    -- 2. 행사장 테이블 — 전문가 1인당 1개(전문가 순서와 동일하게 매핑)
    -- =========================================================================
    FOR e_idx IN 1 .. v_e LOOP
        INSERT INTO public.event_tables (event_id, table_code, description)
        VALUES (v_event, 'F-' || lpad(e_idx::text, 2, '0'), e_idx || '번 상담 테이블')
        RETURNING id INTO v_table;
        v_tables[e_idx] := v_table;
    END LOOP;

    -- =========================================================================
    -- 3. 참가자 — 전문가 전원 + 스타트업 전원 등록(= 전원 참가)
    -- =========================================================================
    INSERT INTO public.event_participants (event_id, user_id, participant_type, default_table_id)
    SELECT v_event, v_experts[i], 'EXPERT', v_tables[i]
    FROM generate_series(1, v_e) AS i;

    INSERT INTO public.event_participants (event_id, user_id, participant_type)
    SELECT v_event, v_startups[i], 'STARTUP'
    FROM generate_series(1, v_s) AS i;

    -- 행사 참가 분야 = 사용자 기본 분야 복제(최대 3 트리거 준수)
    INSERT INTO public.event_participant_fields (event_participant_id, field_id)
    SELECT ep.id, uf.field_id
    FROM public.event_participants ep
    JOIN public.user_fields uf ON uf.user_id = ep.user_id
    WHERE ep.event_id = v_event;

    -- =========================================================================
    -- 4. 매칭 슬롯 — 전문가 × 6개 시간대. 시간대별 케이스 변주.
    --    시간 그리드(50분 간격, now()=현재):
    --      t=0 [now-125..-85]  과거 → COMPLETED (일부 NO_SHOW / CANCELLED)
    --      t=1 [now-75 ..-35]  과거 → COMPLETED (일부 NO_SHOW)
    --      t=2 [now-25 ..+15]  진행 → IN_PROGRESS (일부는 아직 WAITING = 도착·미시작)
    --      t=3 [now+25 ..+65]  예정 → WAITING (예약됨)
    --      t=4 [now+75 ..+115] 예정 → 앞쪽 전문가만 WAITING, 뒤쪽은 빈 슬롯
    --      t=5 [now+125..+165] 예정 → 전부 빈 슬롯(예약 없음)
    --    예약 스타트업 배정: p = t*E + e (0-based) → startups[(p % pool)+1].
    --      같은 시간대(t 고정) 안에서는 e 가 0..E-1 로 연속 → pool>=E 이면 서로 다른 기업
    --      (동시간대 중복예약 없음). 시간대가 다르면 재사용(다른 시각이라 충돌 아님).
    -- =========================================================================
    FOR e_idx IN 0 .. v_e - 1 LOOP
        v_expert := v_experts[e_idx + 1];
        v_table  := v_tables[e_idx + 1];
        FOR t_idx IN 0 .. 5 LOOP
            v_start := v_base + make_interval(mins => t_idx * v_stride);
            v_end   := v_base + make_interval(mins => t_idx * v_stride + v_dur);
            v_p     := t_idx * v_e + e_idx;

            -- 예약 여부/상태/유형 결정 --------------------------------------
            v_startup := NULL;
            v_status  := 'WAITING';
            v_btype   := 'NONE';

            IF t_idx = 5 THEN
                -- 빈 슬롯(예약 없음)
                NULL;
            ELSIF t_idx = 4 AND e_idx >= (v_e + 1) / 2 THEN
                -- 뒤쪽 절반 전문가는 t=4 빈 슬롯
                NULL;
            ELSE
                v_startup := v_startups[(v_p % v_pool) + 1];
                CASE t_idx
                    WHEN 0 THEN
                        v_btype := 'MANUAL';
                        IF e_idx % 7 = 3 THEN
                            v_status := 'NO_SHOW';
                        ELSIF e_idx % 7 = 5 THEN
                            v_status := 'CANCELLED';
                        ELSE
                            v_status := 'COMPLETED';
                        END IF;
                    WHEN 1 THEN
                        v_btype := 'AUTO_AI';
                        IF e_idx % 6 = 2 THEN
                            v_status := 'NO_SHOW';
                        ELSE
                            v_status := 'COMPLETED';
                        END IF;
                    WHEN 2 THEN
                        v_btype := CASE WHEN e_idx % 2 = 0 THEN 'MANUAL' ELSE 'AUTO_AI' END;
                        -- 대부분 진행중, 일부는 도착 후 미시작(WAITING)
                        v_status := CASE WHEN e_idx % 4 = 1 THEN 'WAITING' ELSE 'IN_PROGRESS' END;
                    WHEN 3 THEN
                        v_btype := CASE WHEN e_idx % 3 = 0 THEN 'ADMIN_FORCE' ELSE 'MANUAL' END;
                        v_status := 'WAITING';
                    WHEN 4 THEN
                        v_btype := 'MANUAL';
                        v_status := 'WAITING';
                END CASE;
            END IF;

            INSERT INTO public.matching_slots
                (event_id, expert_id, startup_id, start_time, end_time,
                 table_id, booking_type, session_status)
            VALUES
                (v_event, v_expert, v_startup, v_start, v_end,
                 v_table, v_btype, v_status);
        END LOOP;
    END LOOP;

    -- =========================================================================
    -- 5. 분할뷰(0066) 상담 요청 메모 — 예약된 진행/대기 슬롯 일부에 스타트업 요청사항.
    -- =========================================================================
    UPDATE public.matching_slots ms
    SET counseling_request =
        '상담 요청: 초기 시장 진입 전략과 시드 라운드 밸류에이션에 대한 조언을 구합니다. ' ||
        '특히 B2B 세일즈 파이프라인 구축 관련 실무 피드백을 희망합니다.'
    FROM (
        SELECT id, row_number() OVER (ORDER BY start_time, expert_id) AS n
        FROM public.matching_slots
        WHERE event_id = v_event AND startup_id IS NOT NULL
          AND session_status IN ('IN_PROGRESS', 'WAITING')
    ) x
    WHERE ms.id = x.id AND x.n % 3 = 0;

    -- =========================================================================
    -- 6. 상담일지 — COMPLETED 슬롯에 작성(작성완료). IN_PROGRESS 는 미작성으로 둔다.
    --    레거시 점수 컬럼 + 동적 문항 답변 둘 다 채워 구/신 화면 모두 보이게 한다.
    -- =========================================================================
    -- 6-a. 기본 상담 문항 보장(트리거가 이미 생성했더라도 방어적)
    PERFORM public.ensure_default_counseling_questions(v_event);

    -- 6-b. 상담일지 본문(레거시 점수 포함)
    INSERT INTO public.counseling_logs
        (matching_slot_id, score_technology, score_expertise, score_reliability,
         score_collaboration, score_probability, content,
         follow_up_required, follow_up_memo, is_public, submitted_at)
    SELECT
        c.id,
        3 + (c.n % 3), 4, 5 - (c.n % 2), 3 + (c.n % 2), 2 + (c.n % 3),
        '상담 결과 요약 #' || c.n || ': 기술 검증과 시장성 논의를 진행했습니다. ' ||
        '초기 트랙션이 인상적이며 후속 IR 자료 보완과 파일럿 고객 확보를 권고했습니다.',
        (c.n % 2 = 0),
        CASE WHEN c.n % 2 = 0 THEN '2주 내 후속 미팅 및 투자 검토 제안' ELSE NULL END,
        (c.n % 3 = 0),   -- 일부만 공개
        c.end_time
    FROM (
        SELECT ms.id, ms.end_time,
               row_number() OVER (ORDER BY ms.start_time, ms.expert_id) AS n
        FROM public.matching_slots ms
        WHERE ms.event_id = v_event AND ms.session_status = 'COMPLETED'
    ) AS c;

    -- 6-c. 동적 문항 답변 — 평점(RATING) 문항
    WITH logs AS (
        SELECT cl.id AS log_id,
               row_number() OVER (ORDER BY ms.start_time, ms.expert_id) AS n
        FROM public.counseling_logs cl
        JOIN public.matching_slots ms ON ms.id = cl.matching_slot_id
        WHERE ms.event_id = v_event AND ms.session_status = 'COMPLETED'
    )
    INSERT INTO public.counseling_log_answers (counseling_log_id, question_id, answer_rating)
    SELECT l.log_id, q.id, GREATEST(1, LEAST(5, 3 + ((l.n + q.order_no) % 3)))
    FROM logs l
    JOIN public.counseling_log_questions q
      ON q.event_id = v_event AND q.question_type = 'RATING'
    ON CONFLICT (counseling_log_id, question_id) DO NOTHING;

    -- 6-d. 동적 문항 답변 — 서술(SHORT/LONG) 문항
    WITH logs AS (
        SELECT cl.id AS log_id,
               row_number() OVER (ORDER BY ms.start_time, ms.expert_id) AS n
        FROM public.counseling_logs cl
        JOIN public.matching_slots ms ON ms.id = cl.matching_slot_id
        WHERE ms.event_id = v_event AND ms.session_status = 'COMPLETED'
    )
    INSERT INTO public.counseling_log_answers (counseling_log_id, question_id, answer_text)
    SELECT l.log_id, q.id,
           '상담 의견 #' || l.n || ': 기술 검증과 시장성을 논의했습니다. ' ||
           '초기 트랙션이 우수하며, 후속 IR 자료 보완과 파일럿 고객 확보를 권고했습니다.'
    FROM logs l
    JOIN public.counseling_log_questions q
      ON q.event_id = v_event AND q.question_type IN ('SHORT_ANSWER', 'LONG_ANSWER')
    ON CONFLICT (counseling_log_id, question_id) DO NOTHING;

    -- =========================================================================
    -- 7. 출석 로그 — 완료/진행중/불참 세션에 기록. 대기·취소는 미정으로 둠.
    -- =========================================================================
    -- 전문가 출석(완료·진행중·불참 모두 본인은 PRESENT)
    INSERT INTO public.attendance_logs
        (matching_slot_id, user_id, role_type, attendance_status, check_in_type, checked_in_by, reason)
    SELECT ms.id, ms.expert_id, 'EXPERT', 'PRESENT', 'MANUAL', v_admin, NULL
    FROM public.matching_slots ms
    WHERE ms.event_id = v_event
      AND ms.session_status IN ('COMPLETED', 'IN_PROGRESS', 'NO_SHOW');

    -- 스타트업 출석(완료·진행중은 PRESENT)
    INSERT INTO public.attendance_logs
        (matching_slot_id, user_id, role_type, attendance_status, check_in_type, checked_in_by, reason)
    SELECT ms.id, ms.startup_id, 'STARTUP', 'PRESENT', 'MANUAL', v_admin, NULL
    FROM public.matching_slots ms
    WHERE ms.event_id = v_event
      AND ms.startup_id IS NOT NULL
      AND ms.session_status IN ('COMPLETED', 'IN_PROGRESS');

    -- 스타트업 불참(NO_SHOW 세션)
    INSERT INTO public.attendance_logs
        (matching_slot_id, user_id, role_type, attendance_status, check_in_type, checked_in_by, reason)
    SELECT ms.id, ms.startup_id, 'STARTUP', 'ABSENT', 'MANUAL', v_admin, '시드: 스타트업 미참석(노쇼)'
    FROM public.matching_slots ms
    WHERE ms.event_id = v_event
      AND ms.startup_id IS NOT NULL
      AND ms.session_status = 'NO_SHOW';

    -- =========================================================================
    -- 8. 예약 이력 — CREATED(예약된 슬롯) + CANCELLED(취소된 슬롯)
    --    ⚠ 이 INSERT 는 trg_notify_booking 을 발동시키지만, 아직 이 행사에 대한
    --      event_notification_settings 행이 없어 _enqueue_notification 이 즉시 RETURN 한다(안전).
    -- =========================================================================
    INSERT INTO public.booking_history
        (matching_slot_id, action_type, actor_id, startup_id, expert_id, reason)
    SELECT ms.id, 'CREATED', ms.startup_id, ms.startup_id, ms.expert_id, '개발용 시드 예약(전원참가 LIVE)'
    FROM public.matching_slots ms
    WHERE ms.event_id = v_event AND ms.startup_id IS NOT NULL;

    INSERT INTO public.booking_history
        (matching_slot_id, action_type, actor_id, startup_id, expert_id, reason)
    SELECT ms.id, 'CANCELLED', v_admin, ms.startup_id, ms.expert_id, '개발용 시드: 취소 케이스'
    FROM public.matching_slots ms
    WHERE ms.event_id = v_event AND ms.session_status = 'CANCELLED';

    -- =========================================================================
    -- 9. 만족도 — 정책 BOTH 이므로 행사(EVENT) + 전문가(EXPERT) 응답을 일부 채운다.
    --    (진행중 행사라 전량은 아니고 부분값으로 두어 자연스럽게 보이게 함)
    -- =========================================================================
    PERFORM public.ensure_default_survey_questions(v_event);
    PERFORM public.ensure_default_expert_survey_questions(v_event);

    -- 9-a. 행사 만족도(EVENT) — 스타트업 참가자의 앞쪽 60% 만 응답
    INSERT INTO public.survey_responses (event_id, user_id, user_role, survey_scope, submitted_at)
    SELECT v_event, s.user_id, 'STARTUP', 'EVENT', now() - interval '30 minutes'
    FROM (
        SELECT ep.user_id, row_number() OVER (ORDER BY ep.user_id) AS rn,
               count(*) OVER () AS tot
        FROM public.event_participants ep
        WHERE ep.event_id = v_event AND ep.participant_type = 'STARTUP'
    ) s
    WHERE s.rn <= ceil(s.tot * 0.6);

    WITH resp AS (
        SELECT sr.id AS response_id, row_number() OVER (ORDER BY sr.user_id) AS i
        FROM public.survey_responses sr
        WHERE sr.event_id = v_event AND sr.survey_scope = 'EVENT'
    )
    INSERT INTO public.survey_answers (response_id, question_id, answer_rating)
    SELECT r.response_id, q.id, GREATEST(1, LEAST(5, 5 - ((r.i + q.order_no) % 3)))
    FROM resp r
    JOIN public.survey_questions q
      ON q.event_id = v_event AND q.survey_scope = 'EVENT'
     AND q.target_role IN ('STARTUP', 'ALL') AND q.question_type = 'RATING'
    ON CONFLICT (response_id, question_id) DO NOTHING;

    WITH resp AS (
        SELECT sr.id AS response_id, row_number() OVER (ORDER BY sr.user_id) AS i
        FROM public.survey_responses sr
        WHERE sr.event_id = v_event AND sr.survey_scope = 'EVENT'
    )
    INSERT INTO public.survey_answers (response_id, question_id, answer_text)
    SELECT r.response_id, q.id,
           '행사 운영과 매칭 모두 만족스러웠습니다. 내년에도 꼭 참여하고 싶습니다. (응답 ' || r.i || ')'
    FROM resp r
    JOIN public.survey_questions q
      ON q.event_id = v_event AND q.survey_scope = 'EVENT'
     AND q.target_role IN ('STARTUP', 'ALL')
     AND q.question_type IN ('SHORT_ANSWER', 'LONG_ANSWER')
    WHERE r.i % 2 = 0
    ON CONFLICT (response_id, question_id) DO NOTHING;

    -- 9-b. 전문가 만족도(EXPERT) — 완료 세션(스타트업→전문가)별 응답
    INSERT INTO public.survey_responses
        (event_id, user_id, user_role, survey_scope, target_expert_id, slot_id, submitted_at)
    SELECT v_event, ms.startup_id, 'STARTUP', 'EXPERT', ms.expert_id, ms.id,
           ms.end_time + interval '5 minutes'
    FROM public.matching_slots ms
    WHERE ms.event_id = v_event
      AND ms.startup_id IS NOT NULL
      AND ms.session_status = 'COMPLETED';

    WITH resp AS (
        SELECT sr.id AS response_id, row_number() OVER (ORDER BY sr.slot_id) AS i
        FROM public.survey_responses sr
        WHERE sr.event_id = v_event AND sr.survey_scope = 'EXPERT'
    )
    INSERT INTO public.survey_answers (response_id, question_id, answer_rating)
    SELECT r.response_id, q.id, GREATEST(1, LEAST(5, 4 + ((r.i + q.order_no) % 2)))
    FROM resp r
    JOIN public.survey_questions q
      ON q.event_id = v_event AND q.survey_scope = 'EXPERT'
     AND q.target_role IN ('STARTUP', 'ALL') AND q.question_type = 'RATING'
    ON CONFLICT (response_id, question_id) DO NOTHING;

    WITH resp AS (
        SELECT sr.id AS response_id, row_number() OVER (ORDER BY sr.slot_id) AS i
        FROM public.survey_responses sr
        WHERE sr.event_id = v_event AND sr.survey_scope = 'EXPERT'
    )
    INSERT INTO public.survey_answers (response_id, question_id, answer_text)
    SELECT r.response_id, q.id,
           '전문가님의 피드백이 구체적이고 큰 도움이 되었습니다. 감사합니다. (응답 ' || r.i || ')'
    FROM resp r
    JOIN public.survey_questions q
      ON q.event_id = v_event AND q.survey_scope = 'EXPERT'
     AND q.target_role IN ('STARTUP', 'ALL')
     AND q.question_type IN ('SHORT_ANSWER', 'LONG_ANSWER')
    WHERE r.i % 3 <> 0
    ON CONFLICT (response_id, question_id) DO NOTHING;

    -- =========================================================================
    -- 10. 행사 운영자 / 테이블 현장 담당자 (관리자 계정이 있을 때만)
    -- =========================================================================
    IF v_admin IS NOT NULL THEN
        -- 운영자: 관리자 1명을 OWNER 로
        INSERT INTO public.event_operator_roles (event_id, user_id, permission, created_by)
        VALUES (v_event, v_admin, 'OWNER', v_admin)
        ON CONFLICT DO NOTHING;

        -- 테이블 담당자: 앞쪽 절반 테이블에 관리자 배정(현장 담당 케이스)
        UPDATE public.event_tables et
        SET manager_user_id = v_admin
        FROM (
            SELECT id, row_number() OVER (ORDER BY table_code) AS rn,
                   count(*) OVER () AS tot
            FROM public.event_tables WHERE event_id = v_event
        ) x
        WHERE et.id = x.id AND x.rn <= ceil(x.tot::numeric / 2);
    END IF;

    -- =========================================================================
    -- 11. 행사별 알림 정책 행 — 정책은 표시하되 send_* 토글은 전부 FALSE 로 유지.
    --     (위 booking_history 트리거의 잠재버그 경로를 절대 타지 않게 하기 위함)
    -- =========================================================================
    INSERT INTO public.event_notification_settings
        (event_id, notification_policy, updated_by)
    VALUES (v_event, 'ALIMTALK_SMS', v_admin)
    ON CONFLICT (event_id) DO NOTHING;

    RAISE NOTICE '0070: 적용 완료 — 진행 LIVE 행사 1 / 참가자 전원(전문가 % · 스타트업 %) / 슬롯 %(=%×6).',
                 v_e, v_s, v_e * 6, v_e;
END $$;

-- =============================================================================
-- 롤백 스니펫 (이 시드 데이터만 일괄 삭제하고 싶을 때 수동 실행)
-- =============================================================================
-- DELETE FROM public.events WHERE id = 'a0000000-0000-4000-8000-000000000006';
--   -- 슬롯/참가자/상담일지/출석/이력/만족도/운영자/테이블/알림설정 CASCADE 삭제.
--   -- (전문가/스타트업/관리자 계정은 이 시드가 만들지 않았으므로 보존)
-- =============================================================================
