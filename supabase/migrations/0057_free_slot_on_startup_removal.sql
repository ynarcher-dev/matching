-- 0057_free_slot_on_startup_removal.sql
--
-- 참가자 제거 시 슬롯 처리 정밀화(0056 의 cleanup_slots_on_participant_delete 교체).
--
-- 문제: 0056 은 제거 시 슬롯을 무조건 CANCELLED 로 두었는데, 예약 배치 표
--   (buildBookingSchedule)는 CANCELLED 를 빼버리고 셀을 '슬롯 없음'으로 그려서, 그 전문가의
--   해당 시간이 죽어 다른 기업을 재배정할 수 없었다.
--
-- 정책(확정):
--   • 스타트업 제거 →
--       - 상담일지가 있는(작성된) 세션: 기록 보존을 위해 CANCELLED 로 둔다.
--       - 그 외(예약·대기 등 미작성) 세션: 빈 슬롯으로 되돌린다
--         (startup_id=NULL, session_status='WAITING', booking_type='NONE') → '+ 배정' 으로 부활.
--   • 전문가 제거 → 그 전문가의 슬롯을 완전 삭제(상담일지·출석·제안은 FK CASCADE).
--   어느 경우든 집계 쿼리(CANCELLED/빈 슬롯 제외)와 카운트는 일관된다.

CREATE OR REPLACE FUNCTION public.cleanup_slots_on_participant_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.participant_type = 'STARTUP' THEN
    -- (1) 상담일지가 있는 세션 → 기록 보존 위해 CANCELLED.
    UPDATE public.matching_slots ms
    SET session_status = 'CANCELLED'
    WHERE ms.event_id = OLD.event_id
      AND ms.startup_id = OLD.user_id
      AND ms.session_status <> 'CANCELLED'
      AND EXISTS (SELECT 1 FROM public.counseling_logs cl WHERE cl.matching_slot_id = ms.id);

    -- (2) 상담일지 없는 세션 → 빈 슬롯으로 환원하기 전에, 딸린 출석 로그부터 정리.
    DELETE FROM public.attendance_logs al
    USING public.matching_slots ms
    WHERE al.matching_slot_id = ms.id
      AND ms.event_id = OLD.event_id
      AND ms.startup_id = OLD.user_id
      AND ms.session_status <> 'CANCELLED'
      AND NOT EXISTS (SELECT 1 FROM public.counseling_logs cl WHERE cl.matching_slot_id = ms.id);

    -- (3) 빈 슬롯으로 환원 → '+ 배정' 으로 재배정 가능.
    UPDATE public.matching_slots ms
    SET startup_id = NULL,
        session_status = 'WAITING',
        booking_type = 'NONE'
    WHERE ms.event_id = OLD.event_id
      AND ms.startup_id = OLD.user_id
      AND ms.session_status <> 'CANCELLED'
      AND NOT EXISTS (SELECT 1 FROM public.counseling_logs cl WHERE cl.matching_slot_id = ms.id);

    -- (4) 이 스타트업 관련 AI 제안 정리(보존할 상태값 없음).
    DELETE FROM public.matching_proposals mp
    WHERE mp.event_id = OLD.event_id
      AND mp.startup_id = OLD.user_id;

  ELSE
    -- 전문가 제거 → 그 전문가의 슬롯 전체 삭제(상담일지·출석·제안은 FK CASCADE).
    DELETE FROM public.matching_slots ms
    WHERE ms.event_id = OLD.event_id
      AND ms.expert_id = OLD.user_id;
  END IF;

  RETURN OLD;
END;
$$;
