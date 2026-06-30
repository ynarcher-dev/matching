-- =============================================================================
-- 0044_event_scope_rls_followup.sql — 잔여 전역 RLS → 행사 범위 전환 (B-1 후속)
-- 출처: docs/page_admin_operator_permissions.md §3.2, docs/worklog_operator_permissions.md §2.3
-- =============================================================================
-- 0042(B-1)에서 event_id 를 직접 가진 운영 테이블만 행사 범위로 좁혔다. 본 단계는
-- 이력/로그/설문/상담일지 결과 테이블의 전역 ADMIN SELECT(및 설문/상담 빌더 쓰기)를
-- 행사 범위 헬퍼로 좁혀 일반 운영자가 미배정 행사 데이터를 읽지 못하도록 격리한다.
--
-- 원칙(0042 와 동일):
--   * 헬퍼(can_view/can_manage_event, 0039)는 최고관리자를 무조건 통과 → 무중단.
--   * 참가자(전문가/스타트업) 본인 행 접근 분기는 그대로 보존(전역 ADMIN 분기만 교체).
--   * event_id 직접 컬럼이 없는 이력 테이블은 matching_slot/response 를 경유해 도출.
--   * 정책은 DROP IF EXISTS 후 재생성(멱등). 쓰기는 여전히 RPC 전용(이력/응답).
--
-- 보류(전역 디렉터리·경로 파싱 위험):
--   * users / fields / user_fields / event_participant_fields — 전역 참가자 디렉터리.
--     /admin/users 페이지는 최고관리자 전용으로 게이팅했고, 행사 상세 참가자 배정
--     패널이 후보 user 조회에 의존하므로 전역 유지(스코프 시 후보 조회가 깨질 위험).
--   * storage.objects(event-photos) — 경로 ::uuid 캐스팅 throw 위험. 안전 파싱 헬퍼 후속.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- counseling_logs — 작성 전문가/공개 시 스타트업 본인은 유지, ADMIN→can_view_event(slot)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS clog_select ON public.counseling_logs;
CREATE POLICY clog_select ON public.counseling_logs FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.matching_slots s
        WHERE s.id = matching_slot_id
          AND (
              public.can_view_event(s.event_id)
              OR s.expert_id = public.current_app_user_id()
              OR (is_public = TRUE AND s.startup_id = public.current_app_user_id())
          )
    )
);

-- -----------------------------------------------------------------------------
-- booking_history — 본인(스타트업/전문가) 유지, is_admin_or_staff→can_view_event(slot)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS bh_select ON public.booking_history;
CREATE POLICY bh_select ON public.booking_history FOR SELECT TO authenticated
USING (
    startup_id = public.current_app_user_id()
    OR expert_id = public.current_app_user_id()
    OR EXISTS (
        SELECT 1 FROM public.matching_slots s
        WHERE s.id = matching_slot_id AND public.can_view_event(s.event_id)
    )
);

-- -----------------------------------------------------------------------------
-- attendance_logs — 본인/슬롯 당사자 유지, is_admin_or_staff→can_view_event(slot)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS att_select ON public.attendance_logs;
CREATE POLICY att_select ON public.attendance_logs FOR SELECT TO authenticated
USING (
    user_id = public.current_app_user_id()
    OR EXISTS (
        SELECT 1 FROM public.matching_slots s
        WHERE s.id = matching_slot_id
          AND (
              public.can_view_event(s.event_id)
              OR s.expert_id = public.current_app_user_id()
              OR s.startup_id = public.current_app_user_id()
          )
    )
);

-- -----------------------------------------------------------------------------
-- satisfaction_surveys — 본인 유지, ADMIN→can_view_event(event_id)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS survey_select ON public.satisfaction_surveys;
CREATE POLICY survey_select ON public.satisfaction_surveys FOR SELECT TO authenticated
USING (public.can_view_event(event_id) OR user_id = public.current_app_user_id());

-- -----------------------------------------------------------------------------
-- survey_questions — 참가자 본인 행사 유지, ADMIN 조회→can_view, 빌더 쓰기→can_manage
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS survey_q_select ON public.survey_questions;
CREATE POLICY survey_q_select ON public.survey_questions FOR SELECT TO authenticated
USING (public.can_view_event(event_id) OR public.is_event_participant(event_id));

DROP POLICY IF EXISTS survey_q_insert ON public.survey_questions;
CREATE POLICY survey_q_insert ON public.survey_questions FOR INSERT TO authenticated
WITH CHECK (public.can_manage_event(event_id));

DROP POLICY IF EXISTS survey_q_update ON public.survey_questions;
CREATE POLICY survey_q_update ON public.survey_questions FOR UPDATE TO authenticated
USING (public.can_manage_event(event_id)) WITH CHECK (public.can_manage_event(event_id));

DROP POLICY IF EXISTS survey_q_delete ON public.survey_questions;
CREATE POLICY survey_q_delete ON public.survey_questions FOR DELETE TO authenticated
USING (public.can_manage_event(event_id));

-- -----------------------------------------------------------------------------
-- survey_responses / survey_answers — 본인 유지, ADMIN→can_view_event(event_id)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS survey_r_select ON public.survey_responses;
CREATE POLICY survey_r_select ON public.survey_responses FOR SELECT TO authenticated
USING (public.can_view_event(event_id) OR user_id = public.current_app_user_id());

DROP POLICY IF EXISTS survey_a_select ON public.survey_answers;
CREATE POLICY survey_a_select ON public.survey_answers FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.survey_responses r
        WHERE r.id = response_id
          AND (public.can_view_event(r.event_id) OR r.user_id = public.current_app_user_id())
    )
);

-- -----------------------------------------------------------------------------
-- counseling_log_questions — 참가자 본인 행사 유지, 조회→can_view, 빌더 쓰기→can_manage
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS clog_q_select ON public.counseling_log_questions;
CREATE POLICY clog_q_select ON public.counseling_log_questions FOR SELECT TO authenticated
USING (public.can_view_event(event_id) OR public.is_event_participant(event_id));

DROP POLICY IF EXISTS clog_q_insert ON public.counseling_log_questions;
CREATE POLICY clog_q_insert ON public.counseling_log_questions FOR INSERT TO authenticated
WITH CHECK (public.can_manage_event(event_id));

DROP POLICY IF EXISTS clog_q_update ON public.counseling_log_questions;
CREATE POLICY clog_q_update ON public.counseling_log_questions FOR UPDATE TO authenticated
USING (public.can_manage_event(event_id)) WITH CHECK (public.can_manage_event(event_id));

DROP POLICY IF EXISTS clog_q_delete ON public.counseling_log_questions;
CREATE POLICY clog_q_delete ON public.counseling_log_questions FOR DELETE TO authenticated
USING (public.can_manage_event(event_id));

-- -----------------------------------------------------------------------------
-- counseling_log_answers — 작성 전문가 유지, ADMIN→can_view_event(slot 경유)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS clog_a_select ON public.counseling_log_answers;
CREATE POLICY clog_a_select ON public.counseling_log_answers FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.counseling_logs cl
        JOIN public.matching_slots s ON s.id = cl.matching_slot_id
        WHERE cl.id = counseling_log_id
          AND (public.can_view_event(s.event_id) OR s.expert_id = public.current_app_user_id())
    )
);
