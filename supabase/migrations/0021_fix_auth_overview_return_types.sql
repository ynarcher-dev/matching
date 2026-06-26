-- Keep admin_participant_auth_overview's query output exactly aligned with its
-- declared RETURNS TABLE signature. PostgREST surfaces this mismatch as a 400.
CREATE OR REPLACE FUNCTION public.admin_participant_auth_overview()
RETURNS TABLE (
    user_id UUID,
    otp_channel TEXT,
    otp_status TEXT,
    otp_requested_at TIMESTAMPTZ,
    has_active_emergency BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF public.current_app_role() <> 'ADMIN' THEN
        RAISE EXCEPTION 'admin_participant_auth_overview requires ADMIN role.';
    END IF;

    RETURN QUERY
    WITH last_otp AS (
        SELECT DISTINCT ON (c.user_id)
            c.user_id, c.channel, c.created_at, c.used_at, c.invalidated_at, c.expires_at
        FROM public.auth_otp_challenges c
        WHERE c.purpose = 'PARTICIPANT_LOGIN'
        ORDER BY c.user_id, c.created_at DESC
    ),
    active_emerg AS (
        SELECT DISTINCT t.user_id
        FROM public.emergency_login_tokens t
        WHERE t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at > now()
    )
    SELECT
        u.id,
        lo.channel::TEXT,
        CASE
            WHEN lo.user_id IS NULL THEN 'NONE'
            WHEN lo.used_at IS NOT NULL THEN 'USED'
            WHEN lo.invalidated_at IS NOT NULL THEN 'INVALIDATED'
            WHEN lo.expires_at <= now() THEN 'EXPIRED'
            ELSE 'SENT'
        END::TEXT,
        lo.created_at,
        (ae.user_id IS NOT NULL)
    FROM public.users u
    LEFT JOIN last_otp lo ON lo.user_id = u.id
    LEFT JOIN active_emerg ae ON ae.user_id = u.id
    WHERE u.deleted_at IS NULL AND u.role IN ('EXPERT', 'STARTUP');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_participant_auth_overview() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_participant_auth_overview() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_participant_auth_overview() TO authenticated;
