-- 0056_soften_removal_policy_and_restore_seed_startup1.sql
--
-- (A) 정책 완화: 참가자 제거 시 슬롯을 '완전 삭제' 대신 'CANCELLED' 로 전환한다.
--     0055 는 참가자 제거 시 슬롯을 물리 삭제했는데, 실수 한 번에 상담일지·출석까지
--     영구 소실되는 위험이 있어, 기록을 보존하면서도 집계에서는 빠지도록(취소) 바꾼다.
--     상담일지/예약 집계 쿼리는 이미 session_status<>'CANCELLED' 로 거르므로 페이지 간
--     기업/전문가 수는 동일하게 일관된다.
--
-- (B) 복구: 0055 1회성 정리로 사라진 시드 데모 행사의 기업 #1(뉴럴브릿지) 배치를 되살린다.
--     슬롯 시각은 적용 시점 now() 로 고정됐으므로, 살아있는 같은 전문가(김도현) 슬롯에서
--     기준 시각을 역산해 정확히 재생성한다(추가 전용·가드 포함, 삭제 없음).

-- ── (A) 트리거 정책 완화: DELETE → CANCELLED ─────────────────────────────────
-- 트리거(trg_cleanup_slots_on_participant_delete)는 0055 정의를 그대로 두고, 함수 본문만 교체.
CREATE OR REPLACE FUNCTION public.cleanup_slots_on_participant_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 참가자에서 빠지면 그 사람의 (취소가 아닌) 세션을 CANCELLED 로 전환한다.
  -- 슬롯·상담일지·출석 기록은 보존되며, 집계 쿼리가 CANCELLED 를 제외하므로 카운트는 일관.
  UPDATE public.matching_slots ms
  SET session_status = 'CANCELLED'
  WHERE ms.event_id = OLD.event_id
    AND (ms.startup_id = OLD.user_id OR ms.expert_id = OLD.user_id)
    AND ms.session_status <> 'CANCELLED';

  -- AI 제안은 보존할 상태값(취소)이 없으므로 그대로 정리한다.
  DELETE FROM public.matching_proposals mp
  WHERE mp.event_id = OLD.event_id
    AND mp.startup_id = OLD.user_id;

  RETURN OLD;
END;
$$;

-- ── (B) 시드 데모 기업 #1(뉴럴브릿지) 배치 복구 ──────────────────────────────
DO $$
DECLARE
  v_event   UUID := 'a0000000-0000-4000-8000-000000000005'; -- 회의 데모 LIVE 행사(0053)
  v_expert  UUID := 'e1000000-0000-4000-8000-000000000001'; -- 김도현(rn1 = E-01)
  v_startup UUID := '51000000-0000-4000-8000-000000000001'; -- 뉴럴브릿지(기업 #1)
  v_base    TIMESTAMPTZ;
  v_table   UUID;
  v_ep_id   UUID;
  v_slot0   UUID;
  v_slot2   UUID;
BEGIN
  -- 데모 행사가 없으면(시드 미적용 환경) 복구 스킵.
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = v_event) THEN
    RAISE NOTICE '0056: 시드 데모 행사 없음 — 복구 스킵';
    RETURN;
  END IF;

  -- 이미 이 전문가-기업 슬롯이 있으면(삭제 안 됐거나 이미 복구됨) 스킵 → 중복 방지·재실행 안전.
  IF EXISTS (
    SELECT 1 FROM public.matching_slots
    WHERE event_id = v_event AND expert_id = v_expert AND startup_id = v_startup
  ) THEN
    RAISE NOTICE '0056: 기업 #1 슬롯이 이미 존재 — 복구 스킵';
    RETURN;
  END IF;

  -- 살아있는 김도현 슬롯에서 기준 시각·테이블 역산.
  --   세션 간격 50분(40분 상담 + 10분 휴식). 가장 이른 잔존 슬롯 = idx1(시작 = v_base + 50분).
  SELECT ms.start_time - interval '50 minutes', ms.table_id
    INTO v_base, v_table
  FROM public.matching_slots ms
  WHERE ms.event_id = v_event AND ms.expert_id = v_expert
  ORDER BY ms.start_time
  LIMIT 1;

  IF v_base IS NULL THEN
    RAISE NOTICE '0056: 기준 슬롯을 찾지 못함(전문가 슬롯 없음) — 복구 스킵';
    RETURN;
  END IF;

  -- 1) 기업 #1 계정 활성화(soft delete 됐을 수 있으므로 원복).
  UPDATE public.users SET deleted_at = NULL WHERE id = v_startup;

  -- 2) 참가자 재등록.
  INSERT INTO public.event_participants (event_id, user_id, participant_type)
  VALUES (v_event, v_startup, 'STARTUP')
  ON CONFLICT (event_id, user_id) DO NOTHING;

  SELECT id INTO v_ep_id
  FROM public.event_participants
  WHERE event_id = v_event AND user_id = v_startup;

  -- 3) 참가 분야 = 사용자 기본 분야 복제.
  INSERT INTO public.event_participant_fields (event_participant_id, field_id)
  SELECT v_ep_id, uf.field_id
  FROM public.user_fields uf
  WHERE uf.user_id = v_startup
  ON CONFLICT DO NOTHING;

  -- 4) 슬롯 2개 재생성 — idx0(완료·수동신청), idx2(대기·임의배치). 시드 공식과 동일.
  INSERT INTO public.matching_slots
    (event_id, expert_id, startup_id, start_time, end_time, table_id, booking_type, session_status)
  VALUES
    (v_event, v_expert, v_startup, v_base, v_base + interval '40 minutes',
     v_table, 'MANUAL', 'COMPLETED')
  RETURNING id INTO v_slot0;

  INSERT INTO public.matching_slots
    (event_id, expert_id, startup_id, start_time, end_time, table_id, booking_type, session_status)
  VALUES
    (v_event, v_expert, v_startup, v_base + interval '100 minutes',
     v_base + interval '140 minutes', v_table, 'ADMIN_FORCE', 'WAITING')
  RETURNING id INTO v_slot2;

  -- 5) 완료 슬롯(idx0)에 상담일지 작성.
  INSERT INTO public.counseling_logs
    (matching_slot_id, score_technology, score_expertise, score_reliability,
     score_collaboration, score_probability, content,
     follow_up_required, follow_up_memo, is_public, submitted_at)
  VALUES
    (v_slot0, 4, 4, 5, 4, 3,
     '상담 결과 요약: 온디바이스 AI 추론 가속 기술의 검증과 시장성을 논의했습니다. '
     || '초기 트랙션이 인상적이며 후속 IR 자료 보완을 권고했습니다.',
     TRUE, '2주 내 후속 미팅 및 투자 검토 제안', TRUE,
     v_base + interval '40 minutes');

  -- 6) 출석 로그(완료 세션 → 전문가·기업 모두 PRESENT).
  INSERT INTO public.attendance_logs
    (matching_slot_id, user_id, role_type, attendance_status, check_in_type, reason)
  VALUES
    (v_slot0, v_expert,  'EXPERT',  'PRESENT', 'QR', NULL),
    (v_slot0, v_startup, 'STARTUP', 'PRESENT', 'QR', NULL);

  RAISE NOTICE '0056: 기업 #1(뉴럴브릿지) 배치·상담일지·출석 복구 완료';
END $$;
