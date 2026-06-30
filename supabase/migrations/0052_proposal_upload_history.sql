-- =============================================================================
-- 0052_proposal_upload_history.sql — 스타트업 IR/소개서 업로드 이력 타임라인
-- 출처: 사용자 요청(2026-06-29) — "자료가 바뀐 이력을 타임라인으로 종합 관리"
-- =============================================================================
-- 배경/결정(사용자 합의):
--   지금까지 소개서는 고정 경로(proposals/{id}/proposal.pdf)에 덮어써져, 교체하면
--   이전 PDF 가 물리적으로 사라졌다. 마지막 업로더/시각만 users(0046)에 남았다.
--   요구: "언제 어떤 자료를 올렸는지"를 타임라인으로 보고, 과거 버전도 열람 가능해야 한다.
--
--   따라서:
--     1) 저장 경로를 업로드마다 고유(proposals/{id}/{uuid}.pdf)하게 바꿔 과거본을 보존한다
--        (애플리케이션 storage.ts 변경). 소개서 객체는 더 이상 삭제하지 않는다(이력 보존).
--     2) 업로드/교체/해제 한 건마다 한 행을 남기는 proposal_uploads 이력 테이블을 둔다.
--        파일명·크기를 함께 기록해 "어떤 자료"를 식별한다(경로만으로는 원본명을 알 수 없음).
--     3) 관리자 대행 업로드(supabase 직접 INSERT)와 스타트업 자가 업로드(RPC) 양쪽이
--        같은 이력 테이블에 기록되도록 한다. 업로드 주체는 트리거/RPC 가 서버에서 박는다.
--
--   범위: 스타트업 소개서만. 전문가 프로필 사진(avatars)은 기존 동작(덮어쓰기) 유지.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 이력 테이블
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.proposal_uploads (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    -- UPLOAD: 최초 업로드, REPLACE: 교체, CLEAR: 첨부 해제(현재 소개서 제거)
    action      TEXT NOT NULL CHECK (action IN ('UPLOAD', 'REPLACE', 'CLEAR')),
    -- 이 이력이 가리키는 Storage 객체 경로(proposals/{user_id}/{uuid}.pdf). CLEAR 이면 NULL.
    file_path   TEXT,
    -- 업로드한 원본 파일명(사용자 식별용). 백필/확인 불가 시 NULL.
    file_name   TEXT,
    -- 파일 크기(바이트). 모르면 NULL.
    file_size   BIGINT,
    -- 업로드 주체(관리자 대행 또는 본인). 트리거가 서버에서 기록. 확인 불가 시 NULL.
    uploaded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposal_uploads_user
    ON public.proposal_uploads (user_id, uploaded_at DESC);

-- -----------------------------------------------------------------------------
-- 2. 기존 데이터 백필 — 현재 소개서가 있는 스타트업마다 최초 1건 생성.
--    원본 파일명은 알 수 없어 NULL, 주체/시각은 0046 컬럼을 승계한다(없으면 등록일).
--    (트리거 생성 전에 수행해 백필 행의 주체/시각이 덮어써지지 않게 한다)
-- -----------------------------------------------------------------------------
INSERT INTO public.proposal_uploads (user_id, action, file_path, file_name, uploaded_by, uploaded_at)
SELECT
    u.id,
    'UPLOAD',
    u.proposal_file_url,
    NULL,
    u.proposal_uploaded_by,
    COALESCE(u.proposal_uploaded_at, u.created_at)
FROM public.users u
WHERE u.proposal_file_url IS NOT NULL
  AND u.role = 'STARTUP'
  AND u.deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- 3. 주체/시각 서버 기록 트리거
--    관리자 대행 경로는 클라이언트가 uploaded_by 를 비워 INSERT 하므로, 여기서
--    current_app_user_id() 로 채운다. RPC(자가 업로드)는 이미 본인 id 를 넣어 보낸다.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stamp_proposal_upload()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.uploaded_by IS NULL THEN
        NEW.uploaded_by := public.current_app_user_id();
    END IF;
    IF NEW.uploaded_at IS NULL THEN
        NEW.uploaded_at := now();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_proposal_upload ON public.proposal_uploads;
CREATE TRIGGER trg_stamp_proposal_upload
    BEFORE INSERT ON public.proposal_uploads
    FOR EACH ROW
    EXECUTE FUNCTION public.stamp_proposal_upload();

-- -----------------------------------------------------------------------------
-- 4. RLS — 읽기: 관리자/스태프 + 본인 / 쓰기: 관리자 직접 INSERT(대행 업로드).
--    자가 업로드는 SECURITY DEFINER RPC 로 INSERT 하므로 참가자 INSERT 정책은 두지 않는다.
-- -----------------------------------------------------------------------------
ALTER TABLE public.proposal_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proposal_uploads_select ON public.proposal_uploads;
CREATE POLICY proposal_uploads_select ON public.proposal_uploads FOR SELECT TO authenticated
USING (
    public.is_admin_or_staff()
    OR user_id = public.current_app_user_id()
);

DROP POLICY IF EXISTS proposal_uploads_insert_admin ON public.proposal_uploads;
CREATE POLICY proposal_uploads_insert_admin ON public.proposal_uploads FOR INSERT TO authenticated
WITH CHECK (public.current_app_role() = 'ADMIN');

-- -----------------------------------------------------------------------------
-- 5. set_my_proposal_file RPC 재정의 — 파일명/크기 인자 추가 + 이력 적재.
--    기존 1인자 버전을 제거하고 3인자 버전으로 교체한다(PostgREST 시그니처 충돌 방지).
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.set_my_proposal_file(TEXT);

CREATE OR REPLACE FUNCTION public.set_my_proposal_file(
    p_file_url  TEXT,
    p_file_name TEXT DEFAULT NULL,
    p_file_size BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid    UUID := public.current_app_user_id();
    v_role   TEXT;
    v_old    TEXT;
    v_path   TEXT := NULLIF(btrim(coalesce(p_file_url, '')), '');
    v_action TEXT;
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

    -- 경로 위변조 차단: 본인 폴더(proposals/{본인id}/...) 객체만 가리킬 수 있다. 해제(NULL)는 통과.
    IF v_path IS NOT NULL AND v_path NOT LIKE 'proposals/' || v_uid::text || '/%' THEN
        RAISE EXCEPTION '허용되지 않는 파일 경로입니다.' USING ERRCODE = '22023';
    END IF;

    -- 변경 없음이면 조용히 통과(불필요한 트리거/이력 방지).
    IF v_path IS NOT DISTINCT FROM v_old THEN
        RETURN jsonb_build_object('status', 'OK', 'changed', FALSE);
    END IF;

    v_action := CASE
        WHEN v_path IS NULL THEN 'CLEAR'
        WHEN v_old  IS NULL THEN 'UPLOAD'
        ELSE 'REPLACE'
    END;

    -- proposal_file_url 갱신 → 0046 트리거가 users.proposal_uploaded_at/by(최신 표시용) 기록.
    UPDATE public.users SET proposal_file_url = v_path WHERE id = v_uid;

    -- 타임라인 이력 1건(본인 주체).
    INSERT INTO public.proposal_uploads (user_id, action, file_path, file_name, file_size, uploaded_by)
    VALUES (v_uid, v_action, v_path, NULLIF(btrim(coalesce(p_file_name, '')), ''), p_file_size, v_uid);

    -- 감사 로그(기존 정책 유지).
    INSERT INTO public.audit_logs (actor_id, action, target_type, target_id, old_values, new_values, reason)
    VALUES (
        v_uid,
        CASE v_action
            WHEN 'CLEAR'   THEN 'CLEAR_PROPOSAL_FILE'
            WHEN 'UPLOAD'  THEN 'UPLOAD_PROPOSAL_FILE'
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

REVOKE ALL     ON FUNCTION public.set_my_proposal_file(TEXT, TEXT, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_my_proposal_file(TEXT, TEXT, BIGINT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_my_proposal_file(TEXT, TEXT, BIGINT) TO authenticated;
