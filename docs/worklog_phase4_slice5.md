# 작업 로그 — Phase 4 슬라이스 5 (슬롯 자동 생성 / AI 배치)

> 작성 2026-06-25. 이 문서는 **내일 이어서 작업하기 위한 핸드오프 메모**입니다.
> 큰 맥락은 메모리 `[[phase4-admin-event-user]]` 와 `docs/development_status.md` 를 함께 참고하세요.

---

## ✅ 오늘 완료 — 슬라이스 5a: 시간표 슬롯 자동 생성 (코드 + 라이브 배포 완료)

슬라이스 5 전체(슬롯 자동생성 + AI 배치엔진 + 제안/확정 + 시각화)는 범위가 커서
**한 대화 = 한 슬라이스** 패턴대로 **5a(슬롯 자동 생성)** 부터 완결 구현했습니다.
슬롯이 있어야 강제조정·AI배치·예약이 동작하므로 5a 가 토대입니다.

### 신규 마이그레이션 `0015_slot_generation.sql` (✅ db push 완료, Local=Remote 0001~0015)
- `generate_event_slots(p_event_id, p_start_time, p_session_minutes, p_session_count, p_break_minutes=0, p_expert_ids=NULL, p_replace_unbooked=TRUE)` → 생성 수(INT)
  - 행사 참가 **EXPERT 별로 동일한 시간 그리드**(시작 + i*(세션+휴식), 길이=세션) 빈 슬롯 생성.
  - `booking_type='NONE'`, `session_status='WAITING'`, `startup_id=NULL`, `table_id=NULL`(→ `effective_table_id`(0004)가 전문가 기본 테이블로 해석).
  - 재생성 시 **해당 전문가의 빈 슬롯만 DELETE**(예약/진행 슬롯 보존), 기존 슬롯과 겹치면 건너뜀.
  - 단계 가드: `PROGRESS/FINISHED/CANCELLED` 에서는 생성 불가(=DRAFT/BOOKING/ALLOCATION 만 허용). 숫자 상·하한은 zod 와 동일.
- `clear_unbooked_slots(p_event_id)` → 삭제 수(INT). 빈 슬롯(startup_id NULL · WAITING)만 삭제, 예약 슬롯 보존.
- ACL: `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated` (admin_force_assign/cancel 과 동일 패턴).

### 신규/변경 프론트 파일
- `src/lib/slots.ts` **(신규)** — 순수함수 `buildSlotTrack`/`slotTrackEndIso`/`plannedSlotCount`. DB 그리드 규칙 재현(미리보기·테스트용).
- `src/schemas/eventDetailSchemas.ts` — `slotGenerationSchema`(coerce 숫자, RPC 범위와 정합) + `SlotGenerationValues` 추가.
- `src/hooks/useEventDetailMutations.ts` — `useGenerateSlots`/`useClearUnbookedSlots` 추가(슬롯 쿼리 무효화).
- `src/components/admin/SlotGenerationPanel.tsx` **(신규)** — RHF 폼(시작시각 datetime-local·세션 길이/휴식/횟수·재생성 토글) + 실시간 미리보기(전문가수×횟수, 트랙 시간 칩, 행사 종료 초과 경고) + 빈 슬롯 초기화 ConfirmModal + 현재 슬롯 통계 칩.
- `src/views/admin/EventDetailView.tsx` — `assign`(참가자·테이블) 탭에 `SlotGenerationPanel` 추가.
- `src/test/slots.test.ts` **(신규, 12 케이스)** — 트랙 생성/휴식/결정성/엣지 + 스키마 검증.

### 검증
- `lint`(0) · `typecheck` · `build` · `test` **(68, 신규 12)** 모두 통과.
- `supabase db push` 0015 적용, `migration list` 에서 **Local=Remote 0001~0015** 확인.
- anon 스모크: 신규 RPC 2종이 **검증된 `admin_force_cancel` 게이트와 완전히 동일하게 거동**(둘 다 동일 응답 패턴).

---

## ⚠️ 내일 먼저 볼 것 — 발견한 보안 관찰(프로젝트 전역, 5a 가 만든 게 아님)

스모크 중 발견. **순수 anon(apikey만, Authorization Bearer 없음)** 으로 `clear_unbooked_slots` 호출 시
함수 **body 까지 도달**해 관리자 가드를 통과하고 `"행사를 찾을 수 없습니다."`(가드 이후 단계)를 반환했습니다.

- 원인: `current_app_role()` 이 매핑 없는 호출자에 **NULL** 반환 → `IF current_app_role() <> 'ADMIN' THEN RAISE` 에서
  `NULL <> 'ADMIN'` = **NULL** → plpgsql `IF NULL` 은 거짓 처리 → **RAISE 가 실행되지 않아 가드 우회**.
- 범위: 이 패턴은 **0004/0005/0014 의 모든 관리자 RPC 가 동일**하게 사용 중(admin_force_assign/cancel, mark_no_show, cancel_session 등). 5a 가 새로 만든 문제가 아니라 **기존 전역 패턴**.
- 실제 위험 평가 필요: SECURITY DEFINER 라 RLS 우회 → NULL-role 호출자가 실제 event UUID 로 `clear_unbooked_slots`/`generate_event_slots` 를 호출하면 빈 슬롯을 변경할 수 있는지 **라이브로 재현 확인** 필요(오늘은 zero-UUID 라 "행사 없음"에서 멈춤).
  - 단, 정상 참가자 토큰(EXPERT/STARTUP)은 role 이 'ADMIN' 이 아니므로 **정상적으로 차단**됨. 문제는 role 이 NULL 로 해석되는 토큰(미매핑 authenticated / 키 단독 호출)뿐.
- 권장 수정(전역, 저비용): 모든 관리자 가드를 `current_app_role() IS DISTINCT FROM 'ADMIN'` 또는 `COALESCE(current_app_role(),'') <> 'ADMIN'` 로 교체. 신규 마이그레이션 `0016_admin_guard_null_fix.sql` 로 일괄.
  - ⚠️ 단순 `CREATE OR REPLACE` 로 함수 본문만 교체(시그니처 유지). 결정 후 진행.

---

## ▶ 다음 작업 — 슬라이스 5b: AI 자동배치 엔진 + 제안 + 확정 + 시각화

선행 독서: `docs/page_admin_ai_allocation.md`(이미 완독), `db_schema.md §2.12 matching_proposals` / §4.6.
진입: `/admin/events/:eventId/ai-allocation` (현재 AppRoutes 에서 PlaceholderView, 활성 조건 행사 `ALLOCATION` 단계).

1. **AI 배치 엔진 + 제안 저장 RPC** (`0016` 또는 `0017`): 그리디(랜덤 없음·결정적). 미예약/0회 우선, 분야 적합도(`event_participant_fields` 우선, 없으면 `user_fields`)·시간 충돌 스코어. 결과를 `matching_proposals`(target_slot_id·startup_id·score·field_matched·unmatched_reason·is_locked)에 저장(실제 `matching_slots` 미변경). `is_locked=true` 제안은 재계산 시 보존. 미배치 사유 저장.
2. **확정 RPC**(부분 확정): 제안 → `matching_slots`(booking_type='AUTO_AI') 반영. 충돌 슬롯 제외 + 정상만 부분 확정, 충돌 사유·대상 요약 리포트 반환. `_validate_slot_assignment`(0004) 재사용.
3. **시각화 UI**: `AiAllocationReview` 뷰 + 제안 타임그리드(수동=민트/AI=연보라+"AI 제안" 라벨/충돌=붉은 보더/분야불일치=경고). 미배치 목록·사유. 드래그앤드롭은 후순위(우선 셀렉트 변경 + is_locked).
4. **(메모리상 5 후반) 실시간 TimeGridSheet + 출석**: PROGRESS 단계 타임그리드(Y=전문가/테이블, X=시간) + 출석(check_in RPC 0005 이미 존재). development_status 체크리스트상으로는 Phase 6/진행단계에 가까움 — 5b 와 분리해 별도 슬라이스로 둬도 됨.

### 컨벤션 리마인더(유지)
- 파일 500줄 이하 · 인라인 스타일 금지(Tailwind만) · react-query+RLS 직접/RPC 분리 · labels 단일 매핑 · 이름 해석은 분리쿼리+Map · Modal/TextField/SelectField/ConfirmModal/Toggle 재사용.
- **rpc 호출에 `.returns<>()` 쓰지 말 것**(supabase 타입 충돌 → `as` 캐스트). 예약율 등 동적 width 는 정적 클래스(인라인 금지).
- 슬라이스 2~4 **라이브 풀 라운드트립 미검증분**(긴급링크·세션무효화·CSV INSERT·분야/파일 업로드·강제배정)은 관리자 로그인 + 테스트 참가자 + (이제 생성 가능한) 슬롯으로 5b 진행 중 함께 검증.
