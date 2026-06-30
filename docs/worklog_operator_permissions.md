# 작업 로그 — 운영자 계정 관리 및 행사별 관리자 권한

> 부가 기능 "운영자 계정 관리 및 행사별 관리자 권한"의 구현 경과와 **남은 작업 핸드오프**를 한곳에 정리한 문서입니다.
> 상세 명세: [page_admin_operator_permissions.md](./page_admin_operator_permissions.md) · 권한/트랜잭션 원칙: [security_transactions.md](./security_transactions.md).
> 체크리스트 현황은 [development_status.md](./development_status.md) "부가 기능: 운영자 계정 관리" 섹션과 동기화됩니다.

작업 기간: 2026-06-28 · 대상 프로젝트: `matching` (ref `lyuajfhfwgohjfmozwrk`)

---

## 0. 핵심 설계 결정 (먼저 읽기)

1. **진행 순서 재배치.** 명세 §7 원안과 동일하게, **비파괴 추가 슬라이스(A→C→D→E)를 먼저** 만들고 **파괴적 스코프 전환(B)을 마지막**에 둔다.
   - 이유: B(전역 ADMIN RLS/RPC → 행사 범위)를 먼저 하면, 권한 배정 UI(D/E)가 없는 상태라 **일반 ADMIN 계정이 모든 행사에서 즉시 잠긴다(lockout)**.
2. **권한 헬퍼는 최고관리자를 무조건 통과시킨다.** `can_view_event`/`can_manage_event`/`can_staff_event`/`is_event_operator` 는 전부 `is_super_admin() OR (배정된 행사 권한)` 구조다.
   - 효과: 스코프 전환을 push 해도 **최고관리자(super_admin)는 전 행사 접근이 유지**된다.
3. **라이브 admin 계정이 최고관리자임을 사용자에게 확인받음**(`is_super_admin = true`). 따라서 B 스코프 전환 후에도 현 운영자는 무중단.
4. **service_role(Edge)만 운영자 계정/권한을 변경한다.** Edge 가 호출자 JWT 로 최고관리자를 1차 검증하고, RPC 가 `p_actor` 의 최고관리자 여부를 DB 에서 2차 재검증한다(defense in depth).

---

## 1. 완료된 작업

### 슬라이스 A — DB 권한 모델 ✅ (배포 완료)
- **마이그레이션:** `0039_event_operator_roles.sql`
- `event_operator_roles` 테이블: `(event_id, user_id, permission[OWNER/MANAGER/STAFF/VIEWER], created_by, created_at, revoked_at, revoked_by)`.
  - 활성 권한 유니크: `uniq_event_operator_active` 부분 인덱스(`WHERE revoked_at IS NULL`) — soft revoke 후 재부여 허용.
  - 조회 가속 인덱스: `idx_event_operator_user`, `idx_event_operator_event`.
- 헬퍼(전부 SECURITY DEFINER, `authenticated` EXECUTE, 최고관리자 통과, 0017 NULL-안전 패턴):
  - `is_operator_admin()` = role='ADMIN'
  - `is_event_operator(event_id)` = super 또는 활성 권한 보유
  - `can_manage_event(event_id)` = super 또는 OWNER/MANAGER
  - `can_staff_event(event_id)` = super 또는 OWNER/MANAGER/STAFF
  - `can_view_event(event_id)` = super 또는 활성 권한(VIEWER 이상)
- 테이블 RLS: 조회=최고관리자 전체·운영자 본인 행 / 쓰기=최고관리자 직접(일반 부여·회수는 슬라이스 C Edge 경유). anon revoke.
- **검증:** `db push` + anon `event_operator_roles` SELECT → `42501`.

### 슬라이스 C — 운영자 Auth 관리 API ✅ (배포 완료)
- **마이그레이션:** `0040_operator_admin_rpc.sql` — service_role 전용 RPC(anon/authenticated EXECUTE 회수):
  - `_assert_actor_super_admin(p_actor)` — service_role 컨텍스트(auth.uid() 없음)에서 p_actor 최고관리자 2차 재검증.
  - `admin_create_operator(...)` — `public.users` 운영자 행 + 감사 로그(`CREATE_OPERATOR`).
  - `admin_update_operator(...)` — 이름/역할/super 플래그/비활성화(soft delete). **본인 super 해제·비활성 차단**(자기 잠금 방지). 감사 `UPDATE_OPERATOR`.
  - `record_operator_audit(...)` — 비밀번호 재설정 등 DB 변경 없는 액션의 감사 단독 기록.
  - `grant_event_operator(...)` — 기존 활성 회수 후 신규 부여(=등급 변경 멱등) + 감사 `GRANT_EVENT_OPERATOR`.
  - `revoke_event_operator(...)` — soft revoke + 감사 `REVOKE_EVENT_OPERATOR`.
  - 모든 변경 RPC 는 **사유 필수**.
- **Edge Functions(5):** `operator-create`(Auth 사용자 생성→RPC, DB 실패 시 Auth 삭제 보상, 임시 비밀번호 또는 recovery 링크) / `operator-update`(+Auth ban/unban 으로 로그인 차단·복구) / `operator-reset-password`(임시 비번 또는 recovery 링크) / `event-operator-grant` / `event-operator-revoke`.
  - 공용 `supabase/functions/_shared/operatorAuth.ts`: `authorizeSuperAdmin(req)` = 호출자 JWT → `users.role='ADMIN' AND is_super_admin`.
  - config: 기본 `verify_jwt=true`(게이트 인증) + 함수 내부 super_admin 재검증. (notification-test 와 동일 패턴 — config.toml 추가 불필요.)
- **검증:** `db push` + Edge 5종 `--use-api` deploy + 스모크(anon `grant_event_operator` → `401/42501`, Edge 무인증 → `401`).

### 슬라이스 D — 운영자 관리 UI ✅ (배포 완료)
- **마이그레이션:** `0041_admin_list_operators.sql` — `admin_list_operators()` SECURITY DEFINER(최고관리자만 결과). 비활성(soft delete) 운영자까지 포함 + 배정 행사 수 + `auth.users.last_sign_in_at`. (이유: `users_select` RLS 가 `deleted_at IS NULL` 만 노출 → 비활성 운영자가 일반 조회로 안 보임.)
- **프론트:** 라우트 `/admin/operators`(신규 `RequireSuperAdmin` 가드), Sidebar `navItemsFor`(최고관리자에게만 메뉴 노출).
  - 신규 파일: `types/operator.ts`, `lib/operator.ts`(+test `src/test/operator.test.ts` 9), `schemas/operatorSchemas.ts`, `hooks/useOperators.ts`·`hooks/useOperatorMutations.ts`, `components/admin/{OperatorTable,OperatorFormModal,OperatorSecretModal}.tsx`, `views/admin/OperatorListView.tsx`.
  - 기능: 목록(요약 4지표·검색·비활성 포함)·생성/수정(이메일·역할·최고관리자[ADMIN 한정]·비밀번호 방식·사유)·비활성화/재활성화·비밀번호 재설정·임시 비번/링크 1회 노출.
  - `labels.ts`: `OPERATOR_ROLE_LABELS`, `OPERATOR_PERMISSION_LABELS` 추가.
- **검증:** `db push` + anon `admin_list_operators` → `42501` + `lint/typecheck/build/test(226)`.

### 슬라이스 E — 행사별 권한 배정 UI + 프론트 게이팅 ✅ (완료)
- 신규 마이그레이션 없음(0039 테이블 + 0040 Edge 재사용).
- `components/admin/OperatorPermissionModal.tsx`(테이블 `권한 배정` 버튼): 운영자별 활성 행사 권한 목록 + 부여/등급 변경(멱등)/회수(모두 사유 필수).
- `hooks/useOperators.ts#useEventOperatorRoles`(`event_operator_roles` + `events(title)` 임베드), `hooks/useOperatorMutations.ts#useGrantEventOperator/useRevokeEventOperator`(배포된 Edge 연동).
- `types/operator.ts#EventOperatorRole` 추가.
- **프론트 게이팅(2.4, B-2 스코프 적용 후 완료):**
  - 페이지 게이팅 — `/admin/users`·`/admin/settings`·`/admin/operators` → `RequireSuperAdmin`. `lib/navigation.ts#navItemsFor` 가 최고관리자에게만 전역 메뉴 노출(일반 ADMIN 은 `행사 목록`만).
  - 권한 인프라 — `lib/eventPermission.ts`(`effectiveEventPermission`[super=OWNER 상당]·`canManage`/`canStaff`/`canView`/`hasCapability`, +test 8) · `hooks/useMyEventRoles.ts`(본인 `event_operator_roles` 활성 행 조회, super 는 쿼리 생략하고 전 행사 OWNER 로 취급) · `components/admin/EventPermissionBadge`.
  - 행사 목록 — 카드에 `내 권한` 배지, `+ 새 행사 개설`·`편집` 버튼은 `is_super_admin`/`canManage` 게이팅, 일반 운영자 빈 목록은 "배정 행사 없음·운영본부 문의".
  - 행사 상세 — `TAB_CAPABILITY`(manage/staff/view) 로 권한 미달 탭 숨김, 권한 없는 행사 직접 접근은 `권한 없음` 안내, 자율예약 토글·엑셀 내보내기는 MANAGER+.
- **검증:** `lint`·`typecheck`·`build`·`test`(**234**, 신규 8) 통과. ⚠ 일반 운영자 실 로그인 권한별 노출/차단은 F.

### 슬라이스 B-1 — 행사 범위 RLS 전환 ✅ (배포 완료)
- **마이그레이션:** `0042_event_scope_rls.sql` — 아래 테이블의 전역 ADMIN 정책을 DROP/재생성(헬퍼 기반):

  | 테이블 | 새 정책 |
  | :--- | :--- |
  | `events` | SELECT=`can_view_event(id)` 또는 참가자 / INSERT=`is_super_admin()` / UPDATE=`can_manage_event(id)` |
  | `event_tables` | 쓰기=`can_manage_event(event_id)` / 조회=`can_view_event` 또는 참가자 |
  | `event_participants` | 쓰기=`can_manage_event(event_id)` / 조회=`can_view_event` 또는 참가자 |
  | `matching_slots` | 조회 admin 분기=`can_view_event(event_id)`(+본인 expert/startup, 참가자) |
  | `matching_proposals` | SELECT=`can_view_event` / 쓰기=`can_manage_event` |
  | `notification_settings`(전역) | `is_super_admin()` |
  | `event_notification_settings` | SELECT=`can_view_event` / INSERT·UPDATE=`can_manage_event` |
  | `notification_logs` | SELECT=`can_view_event(event_id)` |
  | `audit_logs` | SELECT=`is_super_admin()` (전역 ADMIN → 최고관리자 강화) |
  | `company_photos` | SELECT=`can_staff_event` 또는 기업 본인 / INSERT·UPDATE=`can_staff_event`(+참가자 검증) |

- **보류:** `storage.objects`(event-photos 버킷) 정책은 그대로 둠. 경로에서 `event_id` 를 파싱해 `::uuid` 캐스팅하면 비정상 경로에서 정책이 throw → 최고관리자 포함 전원 사진 접근이 깨질 위험. 사진의 1차 접근 경로인 `company_photos` 테이블 RLS 만 좁혔다.
- **검증:** `db push`(Local=Remote 0001~0042) + anon 스모크 — 스코프 테이블 전부 `200 []`(정책 런타임 에러 없음), `event_notification_settings` 는 0037 anon revoke 로 `42501`(정상).

### 슬라이스 B-2 — 관리자 RPC 가드 행사 범위화 ✅ (배포 완료)
- **마이그레이션:** `0043_event_scope_rpc.sql` — SECURITY DEFINER 핵심 RPC 의 전역 가드를 행사 범위 헬퍼로 교체. **함수 본문은 원본(0004/0005/0014/0015/0018/0019/0020/0034) 그대로 재현하고 가드 라인만 변경**, 실패 메시지도 동일하게 유지.
  - `can_manage_event(event_id)`: `admin_force_assign`·`admin_force_cancel`·`cancel_session`·`generate_event_slots`·`clear_unbooked_slots`·`generate_ai_proposals`·`confirm_ai_proposals`·`retry_notification`.
  - `can_staff_event(event_id)`(출석 성격): `mark_no_show`·`check_in`·`clear_attendance`. `check_in`/`clear_attendance` 는 전역 `IN ('ADMIN','STAFF')` 분기만 헬퍼로 바꾸고 **전문가 셀프 체크 / 담당 전문가의 스타트업 체크 경로는 그대로 유지**.
  - 슬롯 인자 RPC(`p_slot_id`)는 `(SELECT event_id FROM matching_slots WHERE id = p_slot_id)`, 알림은 `(SELECT event_id FROM notification_logs WHERE id = p_id)` 로 event_id 도출 후 헬퍼 호출. 헬퍼 NULL-안전(0017/0039) → 미존재 인자·미매핑 호출자는 거부, super_admin 은 통과.
  - `override_event_status`(0006)는 이미 `is_super_admin()` 이라 미변경. 전역 참가자 디렉터리 RPC(`admin_invalidate_user_sessions`·`issue_emergency_login_token`·`admin_participant_auth_overview` 0012/0021)와 레거시 `issue_access_code`(0002)는 §2.2 방침대로 손대지 않음(전역 정책 확정 후 별도).
- **검증:** `db push`(Local=Remote 0001~0043) + anon 스모크 — `admin_force_assign`/`mark_no_show`/`generate_ai_proposals` 는 헬퍼가 FALSE 반환→기존과 동일한 `…관리자만 가능` P0001 가드 메시지로 거부(헬퍼 런타임 무오류 확인), `retry_notification` 은 anon revoke 로 `42501`. ⚠ **정상경로 회귀는 2.1 의 운영자 실 로그인으로 검증 필요**(헤드리스 불가).

### 슬라이스 B-1 후속 — 잔여 전역 RLS 행사 범위화 ✅ (배포 완료)
- **마이그레이션:** `0044_event_scope_rls_followup.sql` — 이력/로그/설문/상담일지 결과 테이블의 전역 ADMIN SELECT(및 설문·상담 빌더 쓰기)를 행사 범위로 좁힘. 참가자(전문가/스타트업) 본인 행 분기는 보존하고 전역 ADMIN 분기만 헬퍼로 교체.
  - `can_view_event` 로 좁힌 조회: `counseling_logs`·`booking_history`·`attendance_logs`(slot 경유)·`satisfaction_surveys`·`survey_responses`·`survey_answers`(response 경유)·`survey_questions`·`counseling_log_questions`·`counseling_log_answers`(slot 경유).
  - `can_manage_event` 로 좁힌 빌더 쓰기: `survey_questions`·`counseling_log_questions` 의 INSERT/UPDATE/DELETE(설문·상담일지 빌더는 operator supabase 직접 RLS).
- **보류:** `users`/`fields`/`user_fields`/`event_participant_fields`(전역 디렉터리 — `/admin/users` 는 super 게이팅, 행사 상세 참가자 배정 패널이 후보 user 조회에 의존), `storage.objects`(event-photos, 경로 `::uuid` 캐스팅 throw 위험). 둘 다 별도 안전장치 후 후속.
- **검증:** `db push`(Local=Remote 0001~0044) + anon 스모크 — 9개 스코프 테이블 전부 `200 []`(정책 런타임 에러 없음, anon 노출 0).

### 슬라이스 B-1 후속(2) — event-photos 스토리지 RLS 행사 범위화 ✅ (배포 완료)
- **마이그레이션:** `0045_storage_event_scope.sql` — event-photos 버킷 객체 정책(읽기/쓰기/수정/삭제)의 전역 `is_admin_or_staff()` 를 `can_staff_event(경로 event_id)` 로 교체(읽기는 소유 기업 본인도 유지). 0036 의 테이블 RLS(0042 에서 이미 스코프)와 정합.
- **안전 파싱:** 신규 `_event_photo_event_id(name)` = `storage.foldername(name)[1]::uuid`, 0007 `_storage_owner_id` 와 동일하게 `EXCEPTION→NULL`(비정상 경로 throw 없음). NULL→`can_staff_event(NULL)=FALSE` 거부, 최고관리자는 헬퍼 통과로 무중단.
- proposals/avatars 버킷은 경로에 event_id 가 없어(`{purpose}/{owner_id}/...`) 행사 스코프 불가 → 전역 유지(per-user 자산).
- **검증:** `db push`(Local=Remote 0001~0045, 함수·정책 컴파일 무오류). 실 업로드 라운드트립(STAFF 배정/미배정 행사 사진 접근)은 F.

**현재 원격 마이그레이션 상태: Local = Remote 0001~0045.**

---

## 2. 남은 작업 (핸드오프)

### 2.1 테스트 운영자 생성·배정 — ✅ 자동 하니스로 대체(아래 §2.5)

> **갱신(2026-06-28):** service_role 키로 운영자 Auth 계정을 생성·로그인·정리하는 자동 하니스(`scripts/verify-operator-permissions.mjs`)로 F 를 검증 완료했다. 아래 수동 UI 절차는 **운영 중 실제 운영자를 만들 때의 참조용**으로 남긴다(검증 자체는 자동화됨). UI 로 직접 만들 때 순서:

1. 최고관리자로 앱 로그인 → `/admin/operators` 진입.
2. **운영자 추가**: 일반 관리자 1명(role=ADMIN, 최고관리자 체크 해제, "임시 비밀번호 생성") 생성 → 표시된 임시 비밀번호 보관.
3. 같은 화면 **권한 배정**에서 그 운영자에게 행사 A 를 `MANAGER` 로 부여(사유 입력).
4. 가능하면 스태프(role=STAFF) 1명 추가 + 다른 행사를 `STAFF` 로, 뷰어 1명 + `VIEWER` 로 배정해 4계층 시드 구성.
5. 새 시크릿 창에서 일반 관리자 임시 비밀번호로 로그인 → 비밀번호 변경.

> 시드를 SQL 마이그레이션으로 만들지 않은 이유: 운영자는 **Supabase Auth 사용자(비밀번호 해시·identities)** 가 필요해 `INSERT INTO auth.users` 로 만들면 깨지기 쉽다. 방금 만든 **slice D UI(`operator-create` Edge)** 가 정식 생성 경로다.

### 2.2 B-2 — 관리자 RPC 가드 행사 범위화 ✅ (코드+배포 완료 — `0043`, 정상경로 회귀만 F 에서)

**완료:** 아래 표의 행사-종속 RPC 가드를 `0043_event_scope_rpc.sql` 에서 헬퍼로 교체·push 했다(위 §1 참조). 남은 것은 **2.1 운영자 실 로그인으로 정상경로 회귀 검증**(MANAGER 가 배정 행사에서 RPC 성공 / 미배정 행사·VIEWER·STAFF 권한 경계)뿐이며 이는 F 와 함께 수행한다. 아래 표·전역 RPC 방침은 참조용으로 보존한다.

(원 작업 지시 — 참조용) SECURITY DEFINER RPC 의 `current_app_role()='ADMIN'`(또는 `IN ('ADMIN','STAFF')`) 가드를 event 인자 기준 헬퍼로 교체한다. **함수 본문 전체를 충실히 재현(CREATE OR REPLACE)** 해야 하며 — 가드 라인만 바꾸고 나머지 로직은 원본 그대로 — push 시 컴파일로 문법 오류는 잡히지만 **정상경로 회귀는 2.1 의 운영자 계정으로 직접 검증**해야 한다.

| RPC | 위치(현행) | 현 가드 | 교체 대상 헬퍼 |
| :--- | :--- | :--- | :--- |
| `admin_force_assign` | 0004 | `<> 'ADMIN'` | `can_manage_event(event_id)` |
| `admin_force_cancel` | 0014 | `<> 'ADMIN'` | `can_manage_event(event_id)` |
| `cancel_session` | 0005:226 | `<> 'ADMIN'` | `can_manage_event(event_id)` |
| `mark_no_show` | 0005:195 | `<> 'ADMIN'` | `can_staff_event(event_id)` (출석 성격) |
| `check_in` | 0005:278 / 0019 | `IN ('ADMIN','STAFF')` | `can_staff_event(event_id)` |
| `clear_attendance` | 0020 | `IN ('ADMIN','STAFF')` | `can_staff_event(event_id)` |
| `generate_event_slots` | 0015:36 | `<> 'ADMIN'` | `can_manage_event(event_id)` |
| `clear_unbooked_slots` | 0015:116 | `<> 'ADMIN'` | `can_manage_event(event_id)` |
| `generate_ai_proposals` | 0018 | `<> 'ADMIN'` | `can_manage_event(event_id)` |
| `confirm_ai_proposals` | 0018 | `<> 'ADMIN'` | `can_manage_event(event_id)` |
| 수동 알림 발송 RPC | 0034:260 | `<> 'ADMIN'` | `can_manage_event(event_id)` |
| `override_event_status` | 0006 | (확인 필요) | **`is_super_admin()` 유지**(상태 강제 변경=최고관리자, 명세 §3.3) |

전역(행사 비종속) RPC 는 행사 범위가 아니라 **전역 정책**으로 둔다(명세 §5.3):
- `admin_invalidate_user_sessions`·`issue_emergency_login_token`·`admin_participant_auth_overview`(0012/0021) → 전역 참가자 디렉터리 관리. **`is_super_admin()` 또는 별도 "전역 관리자" 정책**으로 결정(현재는 `current_app_role()='ADMIN'`). 정책 확정 후 교체.
- `issue_access_code`(0002, 레거시 Access Code) → 무료 운영 전환으로 비활성 경로. 손대지 않아도 무방(원하면 회수).

각 RPC 는 가드 통과 실패 시 기존과 동일한 메시지로 `RAISE` 하되, 헬퍼 NULL-안전(0017)으로 미매핑 호출자는 거부된다. **super_admin 은 헬퍼를 통과하므로 정상경로 보존**이 핵심 안전장치.

> 현 시점 미실행 위험: 일반 관리자 계정이 아직 없어 super_admin 만 이 RPC 들을 호출한다. **일반 운영자를 실제로 만들어 쓰기 전에 B-2 를 닫으면 된다.**

### 2.3 B-1 후속 — 아직 전역인 RLS ✅ (대부분 완료 — `0044`)

`0044`(테이블)·`0045`(event-photos 스토리지)에서 대부분을 행사 범위로 좁혔다(위 §1 B-1 후속 1·2 참조). **남은 단일 보류 항목:**
- `users` / `fields` / `user_fields` / `event_participant_fields` — 전역 디렉터리. **의도적으로 전역 유지.** 사유: `users` 는 앱 전역 이름 해석의 기반(참가자 포탈이 participantClient 로 전문가/스타트업 이름·프로필을 읽고, 행사 상세 참가자 배정 패널이 후보 user 전역 조회에 의존)이라, 후보 조회를 `can_manage_event` 기준 행사 후보 RPC 로 먼저 리팩터링하지 않은 채 RLS 를 좁히면 참가자 흐름이 깨질 수 있다. §5.3 의 보안 목표(전역 참가자 DB 노출 제한)는 `/admin/users` 최고관리자 게이팅으로 이미 달성. 완전 격리가 필요해지면 ① 행사 후보 조회 RPC(`can_manage_event`) 신설 → ② 배정 패널·이름 임베드를 RPC/명시 조회로 전환 → ③ `users` SELECT 스코프 순으로, **실 로그인 검증과 함께** 진행한다.

### 2.4 프론트 마무리 (E 잔여 + 페이지 게이팅) ✅ 완료

위 슬라이스 E 항목 참조. 결정 사항: **`/admin/users` 는 최고관리자 전용**(`RequireSuperAdmin`)으로 가둠(§5.3 "허용된 전역 관리자" 플래그가 아직 없어 보수적으로 super 전용; 향후 플래그 도입 시 완화). `/admin/settings`·`/admin/operators` 도 super 전용. 권한 배지·버튼 잠금·탭 능력별 노출·빈 상태 안내까지 반영. 일반 운영자 실 로그인 회귀는 F.

### 2.5 F — 통합 검증 ✅ (자동 하니스 18/18 통과, 2026-06-28)

**자동 검증:** `scripts/verify-operator-permissions.mjs` — service_role 로 MANAGER/STAFF/VIEWER 테스트 운영자를 생성·행사 A 배정한 뒤 각 계정으로 **실 로그인(signInWithPassword)** 해 단언하고, 종료 시 revoke→삭제로 완전 정리(`optest+*@ynarcher.test`). 실행: `SUPABASE_SERVICE_ROLE_KEY=<키> node scripts/verify-operator-permissions.mjs`.

자동 확인 결과(18/18):
- [x] 미배정 행사(B) 접근 차단 — `events` RLS 0행 + 헬퍼 `can_view/staff/manage` 전부 F.
- [x] MANAGER: 배정 행사 A 에서 view/staff/manage 전부 T, 관리 RPC(`generate_ai_proposals`) 권한 가드 통과(상태 오류만 반환).
- [x] STAFF: A view/staff=T·manage=F, 관리 RPC `관리자만` 차단.
- [x] VIEWER: A view=T·staff/manage=F, 관리 RPC `관리자만` 차단.
- [x] anon·운영자(authenticated) 의 service_role 전용 `grant_event_operator` 직접 호출 `permission denied`(권한 상승 차단).
- [x] 권한 회수 후 즉시 소멸(VIEWER A view→F).
- [x] 최고관리자 무중단(actor 로 생성·배정·회수 전부 수행).
- 참가자 커스텀 JWT 차단: 헬퍼 구조상(참가자=운영자 권한 0행→FALSE) 보장 + 기존 참가자 인증 테스트로 커버.

**잔여(선택, UI 수동 — 자동화 가치 낮음):** STAFF 사진 업로드/출석 실제 플로우, `audit_logs` 관리자 화면 표시. 권한 부여/회수/계정 변경의 감사 기록 자체는 RPC(0040)가 항상 기록한다.

---

## 3. 빠른 참조

- 신규 마이그레이션: `0039`(테이블/헬퍼) · `0040`(운영자/권한 RPC) · `0041`(목록 RPC) · `0042`(RLS 스코프) · `0043`(B-2 RPC 가드) · `0044`(잔여 RLS 스코프) · `0045`(event-photos 스토리지 스코프) — 모두 push 완료.
- 신규 Edge: `operator-create` · `operator-update` · `operator-reset-password` · `event-operator-grant` · `event-operator-revoke` — 모두 deploy 완료.
- 다음 마이그레이션 번호: `0046`.
- 헬퍼 의미 한 줄 요약: `view ⊇ staff ⊇ manage` 아님 주의 — **manage=OWNER/MANAGER, staff=OWNER/MANAGER/STAFF, view=전체 등급**. (staff 가 manage 보다 넓다.)
