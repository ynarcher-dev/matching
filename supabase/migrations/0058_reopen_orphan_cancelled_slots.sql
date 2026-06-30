-- 0058_reopen_orphan_cancelled_slots.sql
--
-- 0056 applied a broad participant-removal policy that converted removed
-- participants' slots to CANCELLED. 0057 fixed the trigger for future startup
-- removals, but any rows already cancelled by 0056 stayed hidden from the admin
-- booking grid because buildBookingSchedule excludes CANCELLED slots.
--
-- Repair only stale startup slots that:
--   - still point to a startup no longer registered for the event,
--   - are CANCELLED,
--   - have no counseling log to preserve.
--
-- Completed/logged sessions remain CANCELLED so their historical records stay
-- out of the booking pool.

DELETE FROM public.attendance_logs al
USING public.matching_slots ms
WHERE al.matching_slot_id = ms.id
  AND ms.session_status = 'CANCELLED'
  AND ms.startup_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.event_participants ep
    WHERE ep.event_id = ms.event_id
      AND ep.user_id = ms.startup_id
      AND ep.participant_type = 'STARTUP'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.counseling_logs cl
    WHERE cl.matching_slot_id = ms.id
  );

UPDATE public.matching_slots ms
SET startup_id = NULL,
    booking_type = 'NONE',
    session_status = 'WAITING'
WHERE ms.session_status = 'CANCELLED'
  AND ms.startup_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.event_participants ep
    WHERE ep.event_id = ms.event_id
      AND ep.user_id = ms.startup_id
      AND ep.participant_type = 'STARTUP'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.counseling_logs cl
    WHERE cl.matching_slot_id = ms.id
  );
