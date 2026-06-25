-- =============================================================================
-- 0011_fix_match_identifier.sql — match_participant_by_identifier 의 min(uuid) 제거
-- 출처: 0009_otp_auth.sql 버그 수정 (라이브 배포 중 발견)
-- =============================================================================
-- 문제:
--   0009 의 match_participant_by_identifier 가 모호 매칭 판별에 `min(u.id)` 를 썼는데,
--   PostgreSQL 에는 uuid 용 min/max 집계가 없어 런타임에
--   `function min(uuid) does not exist` 로 실패했다(RPC 호출이 Edge 500 으로 전파).
-- 조치:
--   `min(uuid)` 대신 `array_agg(u.id)` 로 일치 후보를 모은 뒤 정확히 1명일 때만 확정한다.
--   (array_agg 는 0건이면 NULL → array_length(NULL,1)=NULL ≠ 1 → NULL 반환.)
--   CREATE OR REPLACE 이므로 0009 에서 건 REVOKE(anon/authenticated) ACL 은 유지된다.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.match_participant_by_identifier(p_identifier TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ident TEXT := btrim(coalesce(p_identifier, ''));
    v_email TEXT := lower(v_ident);
    v_phone TEXT := public.normalize_phone(v_ident);
    v_ids UUID[];
BEGIN
    IF v_ident = '' THEN
        RETURN NULL;
    END IF;

    -- 이메일 형식이면 이메일로만, 그 외 숫자 위주면 휴대전화로 매칭.
    IF position('@' IN v_ident) > 0 THEN
        SELECT array_agg(u.id) INTO v_ids
        FROM public.users u
        WHERE u.deleted_at IS NULL
          AND u.role IN ('EXPERT', 'STARTUP')
          AND lower(u.email) = v_email;
    ELSIF length(v_phone) >= 9 THEN
        SELECT array_agg(u.id) INTO v_ids
        FROM public.users u
        WHERE u.deleted_at IS NULL
          AND u.role IN ('EXPERT', 'STARTUP')
          AND public.normalize_phone(u.phone_number) = v_phone;
    ELSE
        RETURN NULL;
    END IF;

    -- 정확히 1명일 때만 확정(0명=미등록, 2명+=모호 → NULL).
    IF array_length(v_ids, 1) = 1 THEN
        RETURN v_ids[1];
    END IF;
    RETURN NULL;
END;
$$;
