-- =============================================================================
-- 0049_startup_self_proposal.sql — 스타트업 IR/소개서 자가 업로드 (Phase 8-H)
-- 출처: docs/functional_followup_plan.md T7, docs/development_status.md 8-H
-- =============================================================================
-- 2026-06-28 기획 확정(사용자 합의):
--   기본 운영 정책은 스타트업이 포털에서 직접 IR/소개서 PDF 를 업로드하는 것이며,
--   미업로드 기업만 관리자가 대신 업로드한다(기존 UserDetailModal 경로 유지).
--   교체 이력은 audit_logs 에 매 교체 기록(사용자 결정), 마지막 업로더/시각은
--   0046 의 proposal_uploaded_at/by 트리거(track_proposal_upload)가 이미 잡는다.
--
-- 권한 구조:
--   * Storage(proposals 버킷) 쓰기/삭제는 0007 정책이 이미 소유 스타트업 본인을
--     허용한다(proposals/{owner_id}/...). 파일 객체 업로드는 participantClient 로 직접.
--   * 단, users.proposal_file_url 갱신은 users_update_admin(ADMIN 전용) RLS 로 막혀
--     있어 참가자가 직접 못 한다. 따라서 본인 행만 갱신하는 SECURITY DEFINER RPC 를 둔다.
--   * current_app_user_id() 는 참가자 커스텀 JWT 클레임에서 본인 id 를 해석하므로
--     SECURITY DEFINER 안에서도 트리거가 업로드 주체를 본인으로 정확히 기록한다.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_my_proposal_file(p_file_url TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid  UUID := public.current_app_user_id();
    v_role TEXT;
    v_old  TEXT;
    v_path TEXT := NULLIF(btrim(coalesce(p_file_url, '')), '');
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = '42501';
    END IF;

    SELECT role, proposal_file_url INTO v_role, v_old
    FROM public.users
    WHERE id = v_uid AND deleted_at IS NULL;

    IF v_role IS DISTINCT FROM 'STARTUP' THEN
        RAISE EXCEPTION '스타트업만 소개서를 업로드할 수 있습니다.' USING ERRCODE = '42501';
    END IF;

    -- 경로 위변조 차단: 본인 폴더(proposals/{본인id}/...) 객체만 가리킬 수 있다.
    -- 해제(NULL)는 통과. Storage RLS 가 1차 게이트지만 컬럼 무결성도 함께 지킨다.
    IF v_path IS NOT NULL AND v_path NOT LIKE 'proposals/' || v_uid::text || '/%' THEN
        RAISE EXCEPTION '허용되지 않는 파일 경로입니다.' USING ERRCODE = '22023';
    END IF;

    -- 변경 없음이면 조용히 통과(불필요한 트리거/감사 기록 방지).
    IF v_path IS NOT DISTINCT FROM v_old THEN
        RETURN jsonb_build_object('status', 'OK', 'changed', FALSE);
    END IF;

    -- proposal_file_url 갱신 → 트리거 track_proposal_upload 가 uploaded_at/by 자동 기록.
    UPDATE public.users SET proposal_file_url = v_path WHERE id = v_uid;

    -- 교체 이력(사용자 결정): 업로드/교체/해제를 audit_logs 에 남긴다.
    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, old_values, new_values, reason)
    VALUES (
        v_uid,
        CASE
            WHEN v_path IS NULL THEN 'CLEAR_PROPOSAL_FILE'
            WHEN v_old  IS NULL THEN 'UPLOAD_PROPOSAL_FILE'
            ELSE 'REPLACE_PROPOSAL_FILE'
        END,
        'users', v_uid,
        jsonb_build_object('proposal_file_url', v_old),
        jsonb_build_object('proposal_file_url', v_path),
        '스타트업 자가 소개서 업로드'
    );

    RETURN jsonb_build_object('status', 'OK', 'changed', TRUE);
END;
$$;

REVOKE ALL     ON FUNCTION public.set_my_proposal_file(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_my_proposal_file(TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_my_proposal_file(TEXT) TO authenticated;
