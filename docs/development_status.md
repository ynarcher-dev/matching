# 개발 현황 및 마일스톤 체크리스트 (Development Status)

이 문서는 비즈니스 매칭 시스템의 구현 진척도를 시각적으로 추적하기 위한 마일스톤 체크리스트입니다. 각 태스크 완료 시마다 상태를 업데이트합니다.

## 전체 진척도: `[###########===========] 52%`

> **2026-06-25 기획 변경(Access Code → OTP, UI 위계 개선) 재작업 코드 완료.** 참가자 인증을 `공통 접속 안내 + 등록 이메일/휴대전화 6자리 OTP`로 전환했고, UI는 전역 `2px 진회색 테두리`에서 `1px 중립 경계선 + 세그먼트 탭 + 연한 상태 배경 + 약한 그림자` 위계로 교체했습니다. 신규 마이그레이션 `0009_otp_auth.sql`(OTP 챌린지·현장 예외 토큰 테이블 + 요청/검증 RPC) + `0010_otp_grants.sql`(service_role EXECUTE) + `0011_fix_match_identifier.sql`(min(uuid) 버그 수정)과 Edge `participant-otp-request`/`participant-otp-verify`(+ Mock 발송 어댑터)를 추가하고, 구 Access Code Edge 2함수를 제거했습니다. **라이브 반영 완료(2026-06-25)**: 0009~0011 `db push`(Local=Remote 0001~0011) + Edge 2함수 deploy + 구 함수(`participant-login`/`participant-resend-code`) 원격 삭제 + 스모크 통과(미등록 OTP요청→`200 generic`, 휴대폰형식 미등록→`200`, OTP검증 오답→`401 invalid_otp`). **✅ `PARTICIPANT_JWT_SECRET` 설정 완료**(레거시 HS256 = "PREVIOUS KEY"로 검증 유효, 등록+verify 재배포). ⚠️ 그 레거시 키 Revoke 금지(=참가자 로그인 중단). **✅ OTP 풀 라운드트립 라이브 검증 완료**: 임시 참가자로 OTP 발급→검증→JWT(exp 12h 확인)→PostgREST 정상토큰 `200`+본인행 / 변조토큰 `401 PGRST301` 대조까지 확인 후 테스트 데이터 정리. **참가자 인증 전 체인(매칭·OTP·커스텀 JWT·RLS) 라이브 작동 확인됨.** 현장 예외 1회용 로그인 링크는 테이블만 생성했고 발급/소비 RPC·Edge·관리자 화면은 Phase 4(참가자 관리 UI)에서 연결합니다.

---

## 📖 개발 선행 독서 규칙
> [!IMPORTANT]
> 특정 Phase 작업을 시작하기 전에 지정된 관련 설계 명세서를 반드시 읽고 작업 기준을 준수해야 합니다.

* **Phase 2 시작 전**: [데이터베이스 설계 명세서 (db_schema.md)](./db_schema.md), [인증·권한·트랜잭션 정책 (security_transactions.md)](./security_transactions.md) 필독
* **Phase 3 시작 전**: [인증 및 공통 레이아웃 명세서 (page_auth_layout.md)](./page_auth_layout.md), [인증·권한·트랜잭션 정책 (security_transactions.md)](./security_transactions.md) 필독
* **Phase 4 시작 전**: 관리자 4대 페이지 명세 필독
  - [행사 목록 (page_admin_event_list.md)](./page_admin_event_list.md)
  - [대시보드 모니터링 (page_admin_event_detail.md)](./page_admin_event_detail.md)
  - [AI 자동배치 (page_admin_ai_allocation.md)](./page_admin_ai_allocation.md)
  - [참가자 DB 관리 (page_admin_user_management.md)](./page_admin_user_management.md)
* **Phase 5 시작 전**: [스타트업 예약 명세서 (page_startup_booking.md)](./page_startup_booking.md) 필독
* **Phase 6 시작 전**: [전문가 대시보드 명세서 (page_expert_dashboard.md)](./page_expert_dashboard.md) 필독

---

## 📅 단계별 세부 태스크

### [x] Phase 1: 기획 수립 및 개발 환경 문서화
- [x] [개발 개요 문서 작성](./overview.md)
- [x] [데이터베이스 설계 및 DDL 분리](./db_schema.md)
- [x] [인증·권한·트랜잭션 정책 작성](./security_transactions.md)
- [x] 개발 단계 설계 및 체크리스트 구성 (`development_status.md`)

### [~] Phase 2: 개발 환경 세팅 & Supabase DB 설계
- [x] Vite + React + TypeScript + Tailwind CSS v4 보일러플레이트 세팅 (빌드 통과)
- [x] Supabase 클라이언트 연동 및 환경 변수(.env.example) 설정 *(실 프로젝트 키 연결은 사용자 환경에서)*
- [x] Supabase DB 스키마 테이블 생성 SQL 작성 (`0001_schema.sql` — 15개 테이블 + 인덱스)
- [x] 역할별 RLS 정책 및 Storage Signed URL 정책 작성 (`0003_rls.sql`, `0007_storage.sql`)
- [x] 예약·변경·취소·강제 배정 DB RPC 및 중복 방지 작성 (`0004_booking_rpc.sql`)
- [x] 행사 상태 1분 Cron 및 최고 관리자 상태 Override 작성 (`0006_status_cron.sql`)
- [x] 예약·출석·감사·알림 이력 테이블 및 제약 조건 (DDL + `0005_session_rpc.sql`)
- [x] 인증 헬퍼·Access Code 해시/검증 빌딩블록 작성 (`0002_auth_helpers.sql`)
- [x] 2026-06-25 명세 동기화 반영: 로그인 실패 잠금 제거 / 상담일지 30자 제한 삭제·임시저장 RPC(`save_counseling_draft`) 추가 / 행사 `allow_startup_self_booking` 토글(예약 변경·취소 ALLOCATION·PROGRESS 허용) / 전문가의 스타트업 출석 체크 허용
- [x] **실 Supabase 프로젝트에 `supabase db push` 적용 및 동작 검증 완료** (`matching` ref `lyuajfhfwgohjfmozwrk`, 0001~0007 + seed). 검증 중 발견·수정한 버그 2건:
  - **(critical)** `participant_login`/`issue_access_code`의 `crypt`/`gen_salt`가 Supabase의 `extensions` 스키마에 있어 `search_path = public, extensions`로 수정 (미수정 시 로그인·코드발급 전면 실패 `42883`).
  - **(security)** `participant_login`·`transition_event_statuses`가 Supabase 기본권한으로 anon/authenticated에 노출됨 → `REVOKE EXECUTE … FROM anon, authenticated`로 차단(검증: anon 호출 시 `42501`).
- 참고: Access Code 분실 셀프 재발송(self-service)·AI 자동배치 엔진/확정 RPC 는 명세상 Phase 3~4 범위로 이관

### [~] Phase 3: 로그인 및 레이아웃 시스템 (반응형 대응)
- [x] 전문가·스타트업 Access Code 해시 기반 간편 로그인 구현 — Edge Function `participant-login`(Deno/jose, 커스텀 JWT HS256 서명) + `ParticipantLoginForm`(역할 탭·식별자+8자리 코드, react-hook-form+zod). 식별자 정규화·검증은 `schemas/authSchemas.ts`.
- [x] 관리자·현장 스태프 Supabase Auth 로그인 구현 — `OperatorLoginForm` + `authStore.loginOperator`(signInWithPassword → `users.auth_user_id` 프로필 검증, 비-운영진 차단).
- [~] Access Code 최초 1회 표시, 재발급, 기존 세션 무효화 구현 — **셀프 재발송** 구현(Edge `participant-resend-code` + 신규 RPC `reissue_access_code_self`(0008), `session_version += 1` 로 기존 코드/세션 즉시 무효화, 계정 열거 방지 generic 응답). 관리자 발급·평문 1회 표시 **화면**은 Phase 4 참가자 관리 UI 에서(빌딩블록 `issue_access_code` 는 0002 에 존재).
- [x] 로그인 세션 유지 및 역할별 리다이렉션 로직 — `authStore`(zustand persist: mode/user, 토큰은 `participantSession` 분리) + `bootstrap`(세션/JWT 만료 검증) + `RequireAuth`→`RequireRole` 가드 + `RootRedirect`/`ROLE_HOME_PATH`.
- [x] 관리자, 현장 스태프, 전문가, 스타트업 모바일 반응형 공통 레이아웃 퍼블리싱 — `AppShell`/`Header`/`Sidebar`(역할별 `ROLE_NAV`), 모바일 퍼스트·`border-2 border-[#515151]`·`#E22213` 적용. 인라인 스타일 0.
  - [x] 반응형 헤더 & 토글형 사이드바 (Tailwind CSS 전용) — 데스크톱 240px 고정 / 모바일 햄버거 슬라이드인 + 백드롭(`uiStore`).
- 검증: `lint`(0 warn)·`typecheck`·`build`·`test`(11 통과). **실서버 반영 완료**: 0008 `supabase db push`(Local↔Remote 동기화) + Edge 2함수 `deploy` + HTTP 스모크 통과(`participant-login`→`401 invalid_credentials`, `participant-resend-code`→`200 {ok}`; crypt 빌딩블록 실배포 경로 무오류 확인). **미완(2건)**: ① `PARTICIPANT_JWT_SECRET` 미설정 — 이 프로젝트는 **비대칭 JWT 서명 키(JWKS)** 체계라 레거시 HS256 시크릿 유효성 확인 필요. ② 실제 로그인 JWT 라운드트립은 테스트 참가자(+Access Code 발급)와 시크릿 설정 후 가능(Phase 4 참가자 관리에서 데이터 생성).

#### [~] 2026-06-25 기획 변경 재작업
- [x] 로그인 카드·입력·탭·오류·버튼에서 전역 굵은 테두리를 제거하고 새 디자인 토큰과 공통 컴포넌트 규칙 적용 — `index.css` 토큰(border/muted/danger/info surface) + `TextField`/`Button`(1px), `RoleTabs`(세그먼트), 신설 `Alert`(왼쪽 강조선)·`Card`(rounded+약한 그림자), `Header`/`Sidebar` 굵은 테두리 제거.
- [x] 참가자 로그인 UI를 `등록 연락처 입력 → OTP 요청 → 6자리 OTP 검증` 2단계 흐름으로 변경 — `ParticipantLoginForm` 2-step + 60초 재발송 쿨다운 + generic 안내. `authSchemas`(otpRequest/otpVerify/classifyIdentifier), `authStore`(requestOtp/verifyOtp), `ResendCodePanel` 제거.
- [x] OTP 챌린지 스키마와 요청·검증 RPC/Edge Function 구현(5분 만료, 60초 재요청, 최대 5회 실패, 계정 열거 방지) — `0009_otp_auth.sql`(`auth_otp_challenges`/`emergency_login_tokens` + `request_participant_otp`/`verify_participant_otp` + `match_participant_by_identifier`/`generate_otp`/`normalize_phone`, RLS deny + anon/authenticated 회수). `0010`에서 service_role EXECUTE 명시 부여(revoke-by-default 클라우드 기본값 대응), `0011`에서 `min(uuid)` 미존재 버그를 `array_agg`로 수정. Edge `participant-otp-request`/`participant-otp-verify`. **원격 배포·스모크 검증 완료.**
- [x] OTP 검증 후 기존 역할별 커스텀 JWT·가드·리다이렉션 흐름에 연결 — verify Edge 가 기존 커스텀 JWT(claims 동일) 서명, `authStore`/가드/`ROLE_HOME_PATH` 재사용.
- [x] 기존 Access Code 발급·재발송 UI/RPC/Edge Function을 제거하거나 안전한 전환 기간 후 폐기 — Edge `participant-login`/`participant-resend-code` 제거. RPC(`participant_login`/`reissue_access_code_self`/`issue_access_code`)는 전환기 보존하되 클라이언트 EXECUTE 회수(0009). DB 컬럼(`access_code_hash`/`access_code_issued_at`)은 데이터 정리 전까지 보존.
- [x] 이메일 기본 발송과 SMS/알림톡 대체 채널, 발송 로그·레이트리밋 — `_shared/notifier.ts` 어댑터 인터페이스 + `MockNotifier`(마스킹 로그, OTP 원문 비저장), 채널 선택(이메일=EMAIL / 휴대전화=SMS), RPC 레벨 60초 레이트리밋. **실 공급사(Solapi 등) 어댑터·감사 로그(notification_logs) 연동은 Phase 7.**
- [x] 관리자 참가자 화면에 인증 가능 채널, 발송 실패, 세션 무효화, 현장용 1회 로그인 링크 기능 반영 — **Phase 4 슬라이스 2에서 완료**. `0012_admin_user_auth.sql`(세션무효화·긴급토큰 발급/소비·참가자 인증 개요 RPC) + Edge `emergency-login` + 참가자 테이블 인증 채널/최근 OTP 상태 컬럼 + 세션 무효화/1회용 로그인 링크 발급 모달 + `/login/emergency` 소비 화면. (✅ 0012 마이그레이션·emergency-login Edge **라이브 배포·스모크 완료**.)
- 후속 구현자는 [UI·OTP 전환 작업 컨텍스트](./agent_context_ui_otp_transition.md)를 먼저 읽습니다.

### [~] Phase 4: 관리자 - 행사 및 유저 관리 (대기/예약 단계)
- [x] **행사 CRUD 관리자 화면 개발 (슬라이스 1, 프론트엔드 완료)** — `/admin/events` 목록(상태 필터 탭·행사명 검색·카드 그리드·빈 화면 대응) + 개설/편집 모달 + 취소(최고관리자 전용). 신규 파일: `types/event.ts`, `lib/datetime.ts`(dayjs utc/timezone 왕복 변환), `lib/labels.ts`(EVENT_STATUS_LABELS), `schemas/eventSchemas.ts`(DB CHECK 정합 + superRefine 일정 순서 검증), `hooks/useEvents.ts`(목록+참가 통계), `hooks/useEventMutations.ts`(생성/수정=직접 INSERT·UPDATE / 취소=`override_event_status` RPC), 공통 `Modal`/`SelectField`, `components/admin/{EventStatusBadge,EventCard,EventFormModal,CancelEventModal}`, `views/admin/EventListView`. 상태 변경(취소)은 최고관리자·사유 필수·감사 로그(override RPC) 경로로 처리, 일반 편집은 events_update_admin RLS 직접 UPDATE. `lint`·`typecheck`·`build`·`test`(25, 신규 12) 통과. **신규 마이그레이션 없음 → 라이브 배포 불필요**(기존 0001~0011 스키마/RPC로 동작). 상세 대시보드(`/admin/events/:eventId`)는 라우트만 placeholder.
- [x] **전문가 및 스타트업 유저 DB 등록/조회 및 CSV 일괄 업로드 파서 개발 (슬라이스 2 완료)** — `/admin/users` 역할 탭(스타트업/전문가)·검색·모바일 가로 스크롤 테이블(이름·기업/소속·이메일·연락처·인증채널·최근 OTP 상태·등록일·조작) + 개별 추가/수정 모달(`UserDetailModal`) + 의존성 없는 CSV 파서(`lib/csv.ts`)·매핑/라인별 검증(`lib/userCsv.ts`)·일괄 업로더(`CsvBulkUploader`, 템플릿 다운로드·오류 0건일 때만 등록). **OTP 후속 동봉**: 세션 무효화(`admin_invalidate_user_sessions` RPC)·1회용 로그인 링크 발급(`issue_emergency_login_token`)/소비(`consume_emergency_login_token`+Edge `emergency-login`)·참가자 인증 개요(`admin_participant_auth_overview`). `0012_admin_user_auth.sql` 신규. 신규 파일: `types/user.ts`, `schemas/userSchemas.ts`, `hooks/{useUsers,useUserMutations}.ts`, 공통 `ConfirmModal`, `components/admin/{UserTable,UserDetailModal,CsvBulkUploader,EmergencyLinkModal}`, `views/admin/UserListView`, `views/EmergencyLoginView`. `lint`·`typecheck`·`build`·`test`(37, 신규 12) 통과. **✅ 라이브 배포 완료(2026-06-25)**: 0012 `db push`(Local=Remote 0001~0012) + Edge `emergency-login` deploy + 스모크 통과(emergency-login 잘못된 토큰→`401 invalid_token`·빈 본문→`400`; consume RPC service_role 실행으로 `digest()` 정상 해석 확인 / `admin_participant_auth_overview`·`issue_emergency_login_token` anon 호출 `42501 permission denied`로 차단 확인). **⚠ 라이브 풀 라운드트립 미검증(슬라이스 3에서 마무리)**: 배포 스모크는 게이트(함수 존재·grants·`digest()` 해석)까지만 확인했고, **관리자 로그인 + 테스트 참가자**가 필요한 전 경로(링크 발급→`/login/emergency`→consume→JWT 본인행 / 세션 무효화 후 기존 JWT `401` / overview 실데이터 반환 / CSV 라이브 INSERT)는 슬라이스 3에서 테스트 참가자 생성 시 함께 검증한다.
- [x] **역할별 상세 프로필, 분야 관계 및 Supabase Storage 파일 관리 (슬라이스 3 완료)** — 참가자 등록/수정 폼에 관심/전문 분야 M:N(`user_fields`, 칩 다중선택 최대 3개) + 역할별 첨부(스타트업=사업소개서 PDF→`proposals` 버킷 / 전문가=프로필 사진→`avatars` 버킷, 비공개 버킷 + 단기 Signed URL 보기)를 통합. 신규 마이그레이션 `0013_fields_limit.sql`(`user_fields`·`event_participant_fields` 대상당 최대 3개 AFTER ROW 트리거 — 전체삭제후 다중INSERT 패턴과 정합). 신규 파일: `lib/storage.ts`(버킷 스펙·검증·업로드/삭제/Signed URL), `hooks/useFields.ts`, `components/admin/{FieldMultiSelect,ParticipantFileInput}`. 변경: `types/user.ts`(field_ids·proposal_file_url·profile_image_url·Field), `schemas/userSchemas.ts`(field_ids max 3), `hooks/useUsers.ts`(user_fields 병합), `hooks/useUserMutations.ts`(`useSaveParticipant` = 스칼라 upsert→분야 교체→파일 업로드 일괄 처리, 기존 useCreateUser/useUpdateUser 대체), `components/admin/UserTable.tsx`(분야 칩·첨부 보기 컬럼), `views/admin/UserListView.tsx`. 분야 선택지/매핑은 `fields` 마스터(seed 12종) 사용. `lint`·`typecheck`·`build`·`test`(41, 신규 4) 통과. **✅ 라이브 배포 완료(2026-06-25)**: `0013` `db push`(Local=Remote 0001~0013, 트리거 생성 무오류; Storage 버킷·RLS는 0007 로 기배포). 슬라이스 2 풀 라운드트립 미검증분(긴급링크·세션무효화·CSV INSERT·이번 분야/파일 업로드)은 관리자 로그인 + 테스트 참가자로 함께 검증 예정.
- [x] **행사 상세 운영 대시보드 + 행사장 테이블·기본 테이블 관리 (슬라이스 4 완료)** — `/admin/events/:eventId` 상태별 진입 탭(참가자·테이블 / 예약 현황 / 강제 조정), CANCELLED 잠금. ①**참가자 지정(DRAFT)**: 전문가/스타트업 서브탭·후보 검색·다중 선택 일괄 추가·제외(`event_participants` ADMIN RLS 직접), 전문가별 기본 테이블 지정(`default_table_id`). ②**행사장 테이블 관리**: `event_tables` 코드·위치·사용여부 등록/편집/삭제(인라인 RHF 폼). ③**예약 현황(BOOKING)**: 예약율 프로그레스(정적 5% width 클래스·인라인 스타일 0)·슬롯/기업 통계·미예약 스타트업 명단(알림 재발송은 Phase 7)·AI 자동배치 링크. ④**강제 조정**: 슬롯 목록(경로·상태 배지) + `ForceBookingModal`(동시간 충돌 스타트업 비활성, 사유 필수)·강제 취소. 신규 `0014_admin_force_cancel.sql`(`admin_force_assign` 짝 — 슬롯 공개·`booking_history`/`audit_logs` 기록), `lib/booking.ts`(예약 통계·충돌 판정 순수함수), `types/eventDetail.ts`, `schemas/eventDetailSchemas.ts`, `hooks/{useEventDetail,useEventDetailMutations}.ts`, 공통 `Toggle`, `components/admin/{EventDetailHeader,ParticipantAssignPanel,EventTablesPanel,BookingStatsPanel,SlotForcePanel,ForceBookingModal}`, `views/admin/EventDetailView`. `labels`에 BOOKING_TYPE/SESSION_STATUS + `participantLabel`. `lint`·`typecheck`·`build`·`test`(56, 신규 eventDetail.test.ts 15) 통과. **✅ 라이브 배포 완료(2026-06-25)**: `0014` `db push`(Local=Remote 0001~0014, 무오류). ACL(`REVOKE ALL FROM PUBLIC`+`GRANT authenticated`)은 검증된 `admin_force_assign`과 동일 패턴. anon HTTP 스모크는 런타임 anon 키(사용자 환경)·관리자 로그인+테스트 슬롯이 있어야 하는 풀 라운드트립으로 슬라이스 5에서 함께 검증.
- [ ] 시간표 예약 슬롯 자동 생성 로직 개발
- [ ] 미예약 인원 AI 자동배치 엔진 코어 개발
- [ ] AI 제안 임시 저장, 잠금, 미배치 사유 및 All-or-Nothing 확정 구현
- [ ] AI 매칭 제안 시각화 대시보드 개발 (색상·아이콘·텍스트 라벨 적용)

### [ ] Phase 5: 스타트업 - 예약 신청 및 관리
- [ ] 스타트업 예약 대시보드 퍼블리싱
- [ ] 전문가 프로필 조회 및 빈 시간대 실시간 예약/변경/취소 구현
- [ ] 예약 신청 시 타임 슬롯 중복 검증 연동
- [ ] 행사별 최대 상담 횟수 제한 로직 적용
- [ ] 동일 전문가 중복 예약 제한 및 예약 이력 연동
- [ ] 공개 상담 코멘트 및 행사 만족도 화면 구현

### [ ] Phase 6: 전문가 - 상담 진행 및 일지 작성 (진행 단계)
- [ ] 전문가 대시보드 퍼블리싱 (본인 시간표)
- [ ] 실시간 남은 상담 시간 카운트다운 타이머 UI 구성
- [ ] 본인 출석 및 명시적 상담 시작 상태 전환 구현
- [ ] 스타트업 세부 정보 및 다차원 스코어카드(평가) 폼 구현
- [ ] 디지털 상담일지 작성 및 완료 처리 기능 연동
- [ ] 상담일지 수정 이력, 공개 범위 및 후속 연계 정보 구현

### [ ] Phase 7: 알림 서비스 및 엑셀 결과 내보내기 (종료 단계)
- [ ] 알림톡(카카오톡) 모킹 전송 클래스 작성 및 알림 이벤트 훅 연결
- [ ] 알림 중복 방지 키, 지수 백오프 3회 및 실패 현황 구현
- [ ] 엑셀 파일 내보내기 라이브러리 연동 및 데이터 가공 모듈 구현
- [ ] 30초 만료 서명 QR 및 현장 스태프 수동 출석 처리 구현
- [ ] 행사 만족도 집계 및 결과 시트 구현

---

## 🛠 유지보수 규칙 체크사항
- [ ] 모든 코드 파일은 **500줄 이하**로 분리되어 있는가?
- [ ] 인라인 스타일(`style={{...}}`)을 사용하지 않고 Tailwind CSS 클래스만 사용했는가?
- [ ] 새로운 코드를 추가/수정할 때마다 본 `development_status.md` 파일의 진척도를 업데이트했는가?
