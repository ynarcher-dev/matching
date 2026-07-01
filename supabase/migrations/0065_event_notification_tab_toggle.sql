-- =============================================================================
-- 0065_event_notification_tab_toggle.sql — 행사알림 탭 노출 토글 (임시 운영 스위치)
-- 출처: 사용자 요청(2026-06-30) — 안내발송 관리에서 행사 상세 '행사알림' 탭의
--       노출 여부를 전역 토글로 임시 관리한다.
-- =============================================================================
-- 설계 원칙:
--   * 전역 싱글턴 notification_settings 에 boolean 컬럼 1개만 추가(임시 스위치).
--   * 기본값 FALSE = 탭 숨김. 최고관리자가 안내발송 관리에서 켜면 노출.
--   * 발송 로직과 무관한 순수 UI 게이트이므로 RPC/게이트 함수는 건드리지 않는다.
-- =============================================================================

ALTER TABLE public.notification_settings
    ADD COLUMN IF NOT EXISTS event_notification_tab_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.notification_settings.event_notification_tab_enabled IS
    '행사 상세 ''행사알림'' 탭 노출 여부(임시 전역 스위치). FALSE=숨김.';
