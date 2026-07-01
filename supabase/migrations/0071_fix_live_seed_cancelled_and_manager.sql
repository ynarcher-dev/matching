-- =============================================================================
-- 0071_fix_live_seed_cancelled_and_manager.sql
--   0070(전원참가 LIVE 행사 F) 시드의 두 가지 비현실적 상태를 실제 앱 거동에 맞게 보정.
-- =============================================================================
-- 배경: 0070 시드가 아래 두 상태를 만들어 그리드에서 오해를 유발했다.
--   (Q1) 테이블 현장 담당자를 관리자로 배정했으나, 이름 해석용 후보(event_operator_roles)
--        SELECT RLS 가 is_super_admin() OR 본인 이라 비-최고관리자 뷰어에게는 이름이 안 잡혀
--        "(배정 외 담당자)" 폴백이 뜬다. 데모에서는 혼란스러우므로 배정을 해제해 '미지정'으로 둔다.
--        (담당자 지정 기능 자체는 테이블 설정 UI 에서 확인. 운영자 OWNER 행은 그대로 둔다.)
--   (Q2) 취소 케이스를 session_status='CANCELLED' + startup_id 유지 로 넣었는데, 이는 실제
--        취소 플로우(0014 admin_force_cancel / 0004 cancel_booking)가 만드는 상태가 아니다.
--        실제 취소는 슬롯을 startup_id=NULL, session_status='WAITING', booking_type='NONE' 로
--        비워 '+ 배정' 으로 되살리고, 취소 사실은 booking_history(CANCELLED)에만 남긴다.
--        (buildBookingSchedule 이 CANCELLED 를 숨기므로, CANCELLED 를 남기면 '죽은 칸'이 된다 —
--         0057~0059 가 없애려던 문제.) → 취소 슬롯을 빈 WAITING 으로 되돌려 재배정 가능하게 한다.
-- 멱등: 대상 조건이 이미 해소된 상태에서 재실행해도 무해(0건 UPDATE).
-- =============================================================================

DO $$
DECLARE
    v_event UUID := 'a0000000-0000-4000-8000-000000000006';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = v_event) THEN
        RAISE NOTICE '0071: LIVE 행사(F) 없음 — 0070 먼저 적용하세요. 스킵.';
        RETURN;
    END IF;

    -- (Q1) 현장 담당자 배정 해제 → 그리드 1열이 '미지정' 으로 표시.
    UPDATE public.event_tables
    SET manager_user_id = NULL
    WHERE event_id = v_event AND manager_user_id IS NOT NULL;

    -- (Q2) 취소 슬롯을 실제 취소 결과(빈 WAITING '+ 배정')로 되돌린다.
    --      취소 사실은 0070 이 이미 넣은 booking_history(CANCELLED) 로 보존된다.
    UPDATE public.matching_slots
    SET startup_id = NULL,
        session_status = 'WAITING',
        booking_type = 'NONE'
    WHERE event_id = v_event AND session_status = 'CANCELLED';

    RAISE NOTICE '0071: 보정 완료 — 현장 담당자 배정 해제(미지정) + 취소 슬롯을 빈 WAITING(+배정)으로 복원.';
END $$;

-- =============================================================================
-- 참고: 이 보정은 데이터만 되돌린다. 앱 레벨 개선(선택)은 별도 검토 대상:
--   • "(배정 외 담당자)" 폴백 문구 개선, 또는 담당자 이름을 event_tables 조회에 직접
--     임베드해 최고관리자 RLS 의존을 없애기(useEventOperators 대신).
--   • event_operator_roles SELECT RLS 를 can_manage_event 까지 확장(NOTE A안).
-- =============================================================================
