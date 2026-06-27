-- =============================================================================
-- 0042_event_scope_rls.sql — 전역 ADMIN RLS → 행사 범위 전환 (부가기능 슬라이스 B-1)
-- 출처: docs/page_admin_operator_permissions.md 3.2
-- =============================================================================
-- 전환 원칙:
--   * 0039 헬퍼(can_view/can_manage/can_staff_event)는 최고관리자를 무조건 통과시키므로
--     라이브 최고관리자 admin 은 전 행사 접근이 유지된다(lockout 없음 — 사전 확인 완료).
--   * 이번 단계는 행사 식별자(event_id)를 직접 가진 운영 테이블의 RLS 만 전환한다.
--     RPC SECURITY DEFINER 가드는 후속(0043), 전역 디렉터리(users/fields/이력)는 보류.
--   * 정책은 DROP IF EXISTS 후 재생성(멱등). 쓰기 트랜잭션은 여전히 RPC 전용 테이블 유지.
--
-- 범위 매핑(명세 3.2):
--   events SELECT  = can_view_event(id) 또는 참가자 / INSERT = 최고관리자 / UPDATE = can_manage_event
--   event_tables·event_participants 쓰기 = can_manage_event(event_id), 조회 = can_view 또는 참가자
--   matching_slots 조회 admin 분기 = can_view_event(event_id)
--   matching_proposals = can_manage_event(event_id)
--   notification_settings(전역) = 최고관리자 / event_notification_settings = can_manage_event
--   notification_logs = can_view_event(event_id) / audit_logs = 최고관리자
--   company_photos = can_staff_event(event_id) 또는 기업 본인 (+ storage)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- events
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS events_select ON public.events;
CREATE POLICY events_select ON public.events FOR SELECT TO authenticated
USING (
    deleted_at IS NULL AND (
        public.can_view_event(id)
        OR public.is_event_participant(id)
    )
);

DROP POLICY IF EXISTS events_insert_admin ON public.events;
CREATE POLICY events_insert_admin ON public.events FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS events_update_admin ON public.events;
CREATE POLICY events_update_admin ON public.events FOR UPDATE TO authenticated
USING (public.can_manage_event(id))
WITH CHECK (public.can_manage_event(id));

-- -----------------------------------------------------------------------------
-- event_tables
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS event_tables_select ON public.event_tables;
CREATE POLICY event_tables_select ON public.event_tables FOR SELECT TO authenticated
USING (public.can_view_event(event_id) OR public.is_event_participant(event_id));

DROP POLICY IF EXISTS event_tables_write_admin ON public.event_tables;
CREATE POLICY event_tables_write_admin ON public.event_tables FOR ALL TO authenticated
USING (public.can_manage_event(event_id))
WITH CHECK (public.can_manage_event(event_id));

-- -----------------------------------------------------------------------------
-- event_participants
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS participants_select ON public.event_participants;
CREATE POLICY participants_select ON public.event_participants FOR SELECT TO authenticated
USING (public.can_view_event(event_id) OR public.is_event_participant(event_id));

DROP POLICY IF EXISTS participants_write_admin ON public.event_participants;
CREATE POLICY participants_write_admin ON public.event_participants FOR ALL TO authenticated
USING (public.can_manage_event(event_id))
WITH CHECK (public.can_manage_event(event_id));

-- -----------------------------------------------------------------------------
-- matching_slots (조회만 — 쓰기는 RPC)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS slots_select ON public.matching_slots;
CREATE POLICY slots_select ON public.matching_slots FOR SELECT TO authenticated
USING (
    public.can_view_event(event_id)
    OR expert_id = public.current_app_user_id()
    OR startup_id = public.current_app_user_id()
    OR public.is_event_participant(event_id)
);

-- -----------------------------------------------------------------------------
-- matching_proposals
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS proposals_select_admin ON public.matching_proposals;
CREATE POLICY proposals_select_admin ON public.matching_proposals FOR SELECT TO authenticated
USING (public.can_view_event(event_id));

DROP POLICY IF EXISTS proposals_write_admin ON public.matching_proposals;
CREATE POLICY proposals_write_admin ON public.matching_proposals FOR ALL TO authenticated
USING (public.can_manage_event(event_id))
WITH CHECK (public.can_manage_event(event_id));

-- -----------------------------------------------------------------------------
-- audit_logs (최고관리자 전용으로 강화 — target_id 가 행사로 한정되지 않음)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS audit_select_admin ON public.audit_logs;
CREATE POLICY audit_select_admin ON public.audit_logs FOR SELECT TO authenticated
USING (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- notification_logs (행사 범위 조회)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS notif_select_admin ON public.notification_logs;
CREATE POLICY notif_select_admin ON public.notification_logs FOR SELECT TO authenticated
USING (public.can_view_event(event_id));

-- -----------------------------------------------------------------------------
-- notification_settings (전역 — 최고관리자 전용)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS notif_settings_select_admin ON public.notification_settings;
CREATE POLICY notif_settings_select_admin ON public.notification_settings FOR SELECT TO authenticated
USING (public.is_super_admin());

DROP POLICY IF EXISTS notif_settings_update_admin ON public.notification_settings;
CREATE POLICY notif_settings_update_admin ON public.notification_settings FOR UPDATE TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- event_notification_settings (행사 관리 권한)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS event_notif_settings_select_admin ON public.event_notification_settings;
CREATE POLICY event_notif_settings_select_admin ON public.event_notification_settings FOR SELECT TO authenticated
USING (public.can_view_event(event_id));

DROP POLICY IF EXISTS event_notif_settings_insert_admin ON public.event_notification_settings;
CREATE POLICY event_notif_settings_insert_admin ON public.event_notification_settings FOR INSERT TO authenticated
WITH CHECK (public.can_manage_event(event_id));

DROP POLICY IF EXISTS event_notif_settings_update_admin ON public.event_notification_settings;
CREATE POLICY event_notif_settings_update_admin ON public.event_notification_settings FOR UPDATE TO authenticated
USING (public.can_manage_event(event_id))
WITH CHECK (public.can_manage_event(event_id));

-- -----------------------------------------------------------------------------
-- company_photos (현장 권한 또는 기업 본인)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS company_photos_select ON public.company_photos;
CREATE POLICY company_photos_select ON public.company_photos FOR SELECT TO authenticated
USING (
    public.can_staff_event(event_id)
    OR company_user_id = public.current_app_user_id()
);

DROP POLICY IF EXISTS company_photos_insert ON public.company_photos;
CREATE POLICY company_photos_insert ON public.company_photos FOR INSERT TO authenticated
WITH CHECK (
    public.can_staff_event(event_id)
    AND uploaded_by = public.current_app_user_id()
    AND EXISTS (
        SELECT 1 FROM public.event_participants ep
        WHERE ep.event_id = company_photos.event_id
          AND ep.user_id = company_photos.company_user_id
          AND ep.participant_type = 'STARTUP'
    )
);

DROP POLICY IF EXISTS company_photos_update ON public.company_photos;
CREATE POLICY company_photos_update ON public.company_photos FOR UPDATE TO authenticated
USING (public.can_staff_event(event_id))
WITH CHECK (public.can_staff_event(event_id));

-- 참고: storage.objects(event-photos 버킷) 정책은 이번 단계에서 변경하지 않는다.
-- 경로에서 event_id 를 파싱해 ::uuid 캐스팅하면 비정상 경로에서 정책이 throw 되어
-- 최고관리자 포함 전원의 사진 접근이 깨질 수 있다. 사진의 1차 접근 경로인
-- company_photos 테이블 RLS 만 행사 범위로 좁히고(위), storage 객체 스코프는
-- 안전한 파싱 헬퍼 도입 후 후속 단계에서 적용한다.
