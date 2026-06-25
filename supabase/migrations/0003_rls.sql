-- =============================================================================
-- 0003_rls.sql — Row Level Security 활성화 + 역할별 정책
-- 출처: docs/security_transactions.md 2장
-- =============================================================================
-- 원칙
--  * 쓰기(예약/변경/취소/강제배정/출석/상태전환/일지)는 SECURITY DEFINER RPC 전용.
--    → 트랜잭션 테이블에는 클라이언트 INSERT/UPDATE/DELETE 정책을 만들지 않는다(거부).
--  * 관리자가 직접 편집하는 마스터 테이블(events/users/fields/event_tables/
--    event_participants/*_fields)만 ADMIN INSERT/UPDATE 정책을 둔다.
--  * 참가자(EXPERT/STARTUP)에게는 본인·공유 행사 범위의 SELECT 만 허용한다.
--  * access_code_hash 등 민감 컬럼은 컬럼 권한으로 추가 차단한다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. 보조 헬퍼
-- -----------------------------------------------------------------------------
-- 현재 사용자가 특정 행사의 참가자인가
CREATE OR REPLACE FUNCTION public.is_event_participant(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.event_participants ep
        WHERE ep.event_id = p_event_id
          AND ep.user_id = public.current_app_user_id()
    );
$$;
REVOKE ALL ON FUNCTION public.is_event_participant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_event_participant(UUID) TO authenticated;

-- 현재 사용자와 대상 사용자가 공유하는 행사가 있는가 (co-participant)
CREATE OR REPLACE FUNCTION public.shares_event_with(p_other UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.event_participants a
        JOIN public.event_participants b ON a.event_id = b.event_id
        WHERE a.user_id = public.current_app_user_id()
          AND b.user_id = p_other
    );
$$;
REVOKE ALL ON FUNCTION public.shares_event_with(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shares_event_with(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_admin_or_staff()
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
    SELECT public.current_app_role() IN ('ADMIN', 'STAFF');
$$;

-- -----------------------------------------------------------------------------
-- 1. RLS 활성화 (전체 테이블)
-- -----------------------------------------------------------------------------
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_participant_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matching_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counseling_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matching_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.satisfaction_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2. 민감 컬럼 차단 (컬럼 레벨 권한)
-- -----------------------------------------------------------------------------
-- access_code_hash / session 관련 컬럼은 어떤 클라이언트도 읽을 수 없다.
REVOKE SELECT (access_code_hash) ON public.users FROM authenticated, anon;

-- -----------------------------------------------------------------------------
-- 3. events
-- -----------------------------------------------------------------------------
CREATE POLICY events_select ON public.events FOR SELECT TO authenticated
USING (
    deleted_at IS NULL AND (
        public.is_admin_or_staff()
        OR public.is_event_participant(id)
    )
);
CREATE POLICY events_insert_admin ON public.events FOR INSERT TO authenticated
WITH CHECK (public.current_app_role() = 'ADMIN');
CREATE POLICY events_update_admin ON public.events FOR UPDATE TO authenticated
USING (public.current_app_role() = 'ADMIN')
WITH CHECK (public.current_app_role() = 'ADMIN');
-- 행사 취소/삭제는 UPDATE(status='CANCELLED' 또는 deleted_at). 물리 DELETE 정책 없음.

-- -----------------------------------------------------------------------------
-- 4. users (본인 / 운영진 / 공유 행사 co-participant 만 조회)
-- -----------------------------------------------------------------------------
CREATE POLICY users_select ON public.users FOR SELECT TO authenticated
USING (
    deleted_at IS NULL AND (
        id = public.current_app_user_id()
        OR public.is_admin_or_staff()
        OR public.shares_event_with(id)
    )
);
CREATE POLICY users_insert_admin ON public.users FOR INSERT TO authenticated
WITH CHECK (public.current_app_role() = 'ADMIN');
CREATE POLICY users_update_admin ON public.users FOR UPDATE TO authenticated
USING (public.current_app_role() = 'ADMIN')
WITH CHECK (public.current_app_role() = 'ADMIN');
-- 참가자 본인 기초정보(소개·연락처) 수정은 허용 컬럼만 갱신하는 RPC(update_my_profile, Phase 4)로 제공.

-- -----------------------------------------------------------------------------
-- 5. fields / user_fields / event_participant_fields (분야)
-- -----------------------------------------------------------------------------
CREATE POLICY fields_select ON public.fields FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY fields_write_admin ON public.fields FOR ALL TO authenticated
USING (public.current_app_role() = 'ADMIN')
WITH CHECK (public.current_app_role() = 'ADMIN');

CREATE POLICY user_fields_select ON public.user_fields FOR SELECT TO authenticated
USING (
    user_id = public.current_app_user_id()
    OR public.is_admin_or_staff()
    OR public.shares_event_with(user_id)
);
CREATE POLICY user_fields_write_admin ON public.user_fields FOR ALL TO authenticated
USING (public.current_app_role() = 'ADMIN')
WITH CHECK (public.current_app_role() = 'ADMIN');

CREATE POLICY epf_select ON public.event_participant_fields FOR SELECT TO authenticated
USING (
    public.is_admin_or_staff() OR EXISTS (
        SELECT 1 FROM public.event_participants ep
        WHERE ep.id = event_participant_id
          AND (ep.user_id = public.current_app_user_id() OR public.is_event_participant(ep.event_id))
    )
);
CREATE POLICY epf_write_admin ON public.event_participant_fields FOR ALL TO authenticated
USING (public.current_app_role() = 'ADMIN')
WITH CHECK (public.current_app_role() = 'ADMIN');

-- -----------------------------------------------------------------------------
-- 6. event_tables / event_participants
-- -----------------------------------------------------------------------------
CREATE POLICY event_tables_select ON public.event_tables FOR SELECT TO authenticated
USING (public.is_admin_or_staff() OR public.is_event_participant(event_id));
CREATE POLICY event_tables_write_admin ON public.event_tables FOR ALL TO authenticated
USING (public.current_app_role() = 'ADMIN')
WITH CHECK (public.current_app_role() = 'ADMIN');

CREATE POLICY participants_select ON public.event_participants FOR SELECT TO authenticated
USING (public.is_admin_or_staff() OR public.is_event_participant(event_id));
CREATE POLICY participants_write_admin ON public.event_participants FOR ALL TO authenticated
USING (public.current_app_role() = 'ADMIN')
WITH CHECK (public.current_app_role() = 'ADMIN');

-- -----------------------------------------------------------------------------
-- 7. matching_slots (조회만 — 모든 쓰기는 RPC)
-- -----------------------------------------------------------------------------
CREATE POLICY slots_select ON public.matching_slots FOR SELECT TO authenticated
USING (
    public.is_admin_or_staff()
    OR expert_id = public.current_app_user_id()
    OR startup_id = public.current_app_user_id()
    -- 예약 단계: 같은 행사 스타트업은 빈 슬롯/타 슬롯을 보고 예약 가능 여부 판단
    OR public.is_event_participant(event_id)
);
-- INSERT/UPDATE/DELETE 정책 없음 → 클라이언트 직접 변경 거부. booking RPC 만 변경.

-- -----------------------------------------------------------------------------
-- 8. counseling_logs (점수는 관리자 전용, 텍스트 공개분만 스타트업 노출)
-- -----------------------------------------------------------------------------
-- 행 접근: 관리자 / 작성 전문가 / (공개된 경우) 해당 스타트업.
-- 점수 컬럼 마스킹은 스타트업 노출용 뷰(Phase 4)에서 처리하고, 여기서는 행 노출만 통제.
CREATE POLICY clog_select ON public.counseling_logs FOR SELECT TO authenticated
USING (
    public.current_app_role() = 'ADMIN'
    OR EXISTS (
        SELECT 1 FROM public.matching_slots s
        WHERE s.id = matching_slot_id
          AND (
              s.expert_id = public.current_app_user_id()
              OR (is_public = TRUE AND s.startup_id = public.current_app_user_id())
          )
    )
);
-- 작성/수정은 submit_counseling_log RPC 전용.

-- -----------------------------------------------------------------------------
-- 9. booking_history / attendance_logs / audit_logs / matching_proposals
--    (이력·제안: 관리자 전체, 참가자는 본인 관련만. 쓰기는 RPC/관리자)
-- -----------------------------------------------------------------------------
CREATE POLICY bh_select ON public.booking_history FOR SELECT TO authenticated
USING (
    public.is_admin_or_staff()
    OR startup_id = public.current_app_user_id()
    OR expert_id = public.current_app_user_id()
);

CREATE POLICY att_select ON public.attendance_logs FOR SELECT TO authenticated
USING (
    public.is_admin_or_staff()
    OR user_id = public.current_app_user_id()
    OR EXISTS (
        SELECT 1 FROM public.matching_slots s
        WHERE s.id = matching_slot_id
          AND (s.expert_id = public.current_app_user_id() OR s.startup_id = public.current_app_user_id())
    )
);

CREATE POLICY audit_select_admin ON public.audit_logs FOR SELECT TO authenticated
USING (public.current_app_role() = 'ADMIN');

CREATE POLICY proposals_select_admin ON public.matching_proposals FOR SELECT TO authenticated
USING (public.current_app_role() = 'ADMIN');
CREATE POLICY proposals_write_admin ON public.matching_proposals FOR ALL TO authenticated
USING (public.current_app_role() = 'ADMIN')
WITH CHECK (public.current_app_role() = 'ADMIN');

-- -----------------------------------------------------------------------------
-- 10. satisfaction_surveys (본인 작성/조회, 행사당 1회는 UNIQUE 제약으로 보장)
-- -----------------------------------------------------------------------------
CREATE POLICY survey_select ON public.satisfaction_surveys FOR SELECT TO authenticated
USING (public.current_app_role() = 'ADMIN' OR user_id = public.current_app_user_id());
CREATE POLICY survey_insert_self ON public.satisfaction_surveys FOR INSERT TO authenticated
WITH CHECK (
    user_id = public.current_app_user_id()
    AND public.is_event_participant(event_id)
);
-- 제출 후 수정 불가 → UPDATE/DELETE 정책 없음.

-- -----------------------------------------------------------------------------
-- 11. notification_logs (관리자만 조회. 발송은 서버/Edge service_role)
-- -----------------------------------------------------------------------------
CREATE POLICY notif_select_admin ON public.notification_logs FOR SELECT TO authenticated
USING (public.current_app_role() = 'ADMIN');
