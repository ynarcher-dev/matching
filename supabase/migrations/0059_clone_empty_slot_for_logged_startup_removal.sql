-- 0059_clone_empty_slot_for_logged_startup_removal.sql
--
-- A removed startup can have a completed/logged slot. Keeping that original slot
-- CANCELLED preserves counseling and attendance history, but the admin grids hide
-- CANCELLED rows, so the bookable slot disappears. For logged removals, keep the
-- historical row and create a separate empty WAITING slot with the same
-- event/expert/time/table.

CREATE OR REPLACE FUNCTION public.cleanup_slots_on_participant_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.participant_type = 'STARTUP' THEN
    -- Logged sessions: preserve the original row as CANCELLED, then make sure
    -- an active empty replacement exists for the same expert/time/table.
    WITH logged_slots AS (
      UPDATE public.matching_slots ms
      SET session_status = 'CANCELLED'
      WHERE ms.event_id = OLD.event_id
        AND ms.startup_id = OLD.user_id
        AND ms.session_status <> 'CANCELLED'
        AND EXISTS (
          SELECT 1
          FROM public.counseling_logs cl
          WHERE cl.matching_slot_id = ms.id
        )
      RETURNING ms.event_id, ms.expert_id, ms.start_time, ms.end_time, ms.table_id
    )
    INSERT INTO public.matching_slots
      (event_id, expert_id, startup_id, start_time, end_time, table_id, booking_type, session_status)
    SELECT ls.event_id, ls.expert_id, NULL, ls.start_time, ls.end_time, ls.table_id, 'NONE', 'WAITING'
    FROM logged_slots ls
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.matching_slots existing
      WHERE existing.event_id = ls.event_id
        AND existing.expert_id = ls.expert_id
        AND existing.start_time = ls.start_time
        AND existing.end_time = ls.end_time
        AND existing.session_status <> 'CANCELLED'
    );

    -- Unlogged sessions: clear the original slot so it remains directly bookable.
    DELETE FROM public.attendance_logs al
    USING public.matching_slots ms
    WHERE al.matching_slot_id = ms.id
      AND ms.event_id = OLD.event_id
      AND ms.startup_id = OLD.user_id
      AND ms.session_status <> 'CANCELLED'
      AND NOT EXISTS (
        SELECT 1
        FROM public.counseling_logs cl
        WHERE cl.matching_slot_id = ms.id
      );

    UPDATE public.matching_slots ms
    SET startup_id = NULL,
        session_status = 'WAITING',
        booking_type = 'NONE'
    WHERE ms.event_id = OLD.event_id
      AND ms.startup_id = OLD.user_id
      AND ms.session_status <> 'CANCELLED'
      AND NOT EXISTS (
        SELECT 1
        FROM public.counseling_logs cl
        WHERE cl.matching_slot_id = ms.id
      );

    DELETE FROM public.matching_proposals mp
    WHERE mp.event_id = OLD.event_id
      AND mp.startup_id = OLD.user_id;

  ELSE
    DELETE FROM public.matching_slots ms
    WHERE ms.event_id = OLD.event_id
      AND ms.expert_id = OLD.user_id;
  END IF;

  RETURN OLD;
END;
$$;

-- Backfill replacements for logged orphan startup slots that were already
-- cancelled by 0056/0057/0058.
INSERT INTO public.matching_slots
  (event_id, expert_id, startup_id, start_time, end_time, table_id, booking_type, session_status)
SELECT ms.event_id, ms.expert_id, NULL, ms.start_time, ms.end_time, ms.table_id, 'NONE', 'WAITING'
FROM public.matching_slots ms
WHERE ms.session_status = 'CANCELLED'
  AND ms.startup_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.counseling_logs cl
    WHERE cl.matching_slot_id = ms.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.event_participants ep
    WHERE ep.event_id = ms.event_id
      AND ep.user_id = ms.startup_id
      AND ep.participant_type = 'STARTUP'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.matching_slots existing
    WHERE existing.event_id = ms.event_id
      AND existing.expert_id = ms.expert_id
      AND existing.start_time = ms.start_time
      AND existing.end_time = ms.end_time
      AND existing.session_status <> 'CANCELLED'
  );
