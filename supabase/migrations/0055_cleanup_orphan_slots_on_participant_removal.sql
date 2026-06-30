-- 0055_cleanup_orphan_slots_on_participant_removal.sql
-- 참가자(스타트업/전문가) 삭제·제외 시 매칭 슬롯과 딸린 데이터를 정리한다.
--
-- 배경:
--   useSoftDeleteUser 는 users.deleted_at 만 UPDATE 하고, useRemoveParticipant 는
--   event_participants 만 DELETE 한다. 두 경로 모두 matching_slots 의 FK
--   (expert_id ON DELETE CASCADE / startup_id ON DELETE SET NULL)를 물리 DELETE 가
--   아니므로 발동시키지 못해, matching_slots(및 counseling_logs, attendance_logs,
--   matching_proposals)가 잔존(orphan)했다. 그 결과 상담일지(슬롯의 startup_id 직접 집계)와
--   참가자 기준 페이지의 기업/전문가 수가 서로 달랐다.
--
-- 정책(확정): 참가자 제거 시 그 사람이 든 슬롯을 "완전 삭제"한다.
--   상담일지·출석·제안은 matching_slots FK CASCADE 로 함께 삭제되고,
--   booking_history 는 SET NULL 로 이력만 보존된다.

-- ── 1) event_participants 제거 시 슬롯 정리 트리거 ────────────────────────────
-- 행사에서 참가자를 빼면(useRemoveParticipant/useRemoveParticipants), 그 행사에서
-- 해당 사용자가 스타트업이든 전문가든 들어간 슬롯을 모두 삭제한다.
CREATE OR REPLACE FUNCTION public.cleanup_slots_on_participant_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.matching_slots ms
  WHERE ms.event_id = OLD.event_id
    AND (ms.startup_id = OLD.user_id OR ms.expert_id = OLD.user_id);

  -- 이 스타트업을 다른(유효한) 전문가 슬롯에 올린 AI 제안은 슬롯 삭제로 안 잡히므로 별도 정리.
  DELETE FROM public.matching_proposals mp
  WHERE mp.event_id = OLD.event_id
    AND mp.startup_id = OLD.user_id;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_slots_on_participant_delete ON public.event_participants;
CREATE TRIGGER trg_cleanup_slots_on_participant_delete
  AFTER DELETE ON public.event_participants
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_slots_on_participant_delete();

-- ── 2) users soft delete 시 참가행 제거 → (1) 트리거가 슬롯까지 연쇄 정리 ──────
-- deleted_at 이 NULL → 값 으로 바뀌는 순간(진짜 비활성화)에만 동작한다.
-- 운영자(OPERATOR/ADMIN/STAFF) 비활성화도 deleted_at 을 쓰지만, 그들은 event_participants
-- 행이 없으므로 영향이 없다(no-op).
CREATE OR REPLACE FUNCTION public.cleanup_on_user_soft_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    -- 참가자로 등록된 모든 행사에서 참가행 제거. 이 DELETE 가 (1) 트리거를 행마다
    -- 발동시켜 슬롯/상담일지/출석/제안까지 정리한다.
    DELETE FROM public.event_participants ep
    WHERE ep.user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_on_user_soft_delete ON public.users;
CREATE TRIGGER trg_cleanup_on_user_soft_delete
  AFTER UPDATE OF deleted_at ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_on_user_soft_delete();

-- ── 3) 기존 잔존(orphan) 데이터 1회 정리 ─────────────────────────────────────
-- 3-1) 이미 soft delete 된 사용자의 참가행 제거(→ (1) 트리거로 슬롯도 정리됨).
DELETE FROM public.event_participants ep
USING public.users u
WHERE ep.user_id = u.id
  AND u.deleted_at IS NOT NULL;

-- 3-2) 참가행 없이 떠 있는 슬롯 정리(과거 '행사에서 제외' 로 생긴 orphan, 또는 3-1 의 잔여).
--      빈 슬롯(startup_id IS NULL)은 정상이므로 건드리지 않는다.
DELETE FROM public.matching_slots ms
WHERE ms.startup_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.event_participants ep
    WHERE ep.event_id = ms.event_id
      AND ep.user_id = ms.startup_id
      AND ep.participant_type = 'STARTUP'
  );

DELETE FROM public.matching_slots ms
WHERE ms.expert_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.event_participants ep
    WHERE ep.event_id = ms.event_id
      AND ep.user_id = ms.expert_id
      AND ep.participant_type = 'EXPERT'
  );

-- 3-3) 참가행 없는 스타트업을 가리키는 잔여 AI 제안 정리.
DELETE FROM public.matching_proposals mp
WHERE NOT EXISTS (
  SELECT 1 FROM public.event_participants ep
  WHERE ep.event_id = mp.event_id
    AND ep.user_id = mp.startup_id
    AND ep.participant_type = 'STARTUP'
);
