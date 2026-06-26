# 작업 로그 — Phase 5 (스타트업 예약 포탈)

> 진행 중 핸드오프 문서. **상세 구현 내역은 메모리 [[phase5-startup-booking]] 참고.**
> 이 문서는 완료 상태·핵심 설계 결정·미검증 항목을 요약한다.
> 선행 독서: [page_startup_booking.md](./page_startup_booking.md).

---

## 완료·배포 상태

### ✅ 슬라이스 1 — 스타트업 예약 포탈 핵심 (코드 완료, 2026-06-26)
`/startup/booking` `StartupPortalView` (PlaceholderView 대체). 체크리스트 1~5번 커버.

- **행사 스위처**: 복수 참가 행사를 pill 로 전환.
- **나의 매칭 예약**(`MyBookingList`): 예약 카드(시간·전문가·테이블) + `예약 현황 N회 / 최대 M회` 배지 + 시간 변경/예약 취소.
- **예약 신청 일정표**(`BookingSlotsGrid`): 전문가(행)×시간(열) **매트릭스 표**(기본) + 시간대별 목록(좁은 화면용). 셀 색: **신청 가능**=흰 배경·초록 글씨(클릭 가능), **✓ 내 예약**=채운 진초록, **마감/신청 불가**=회색. 셀 전체가 클릭 영역(td 레벨, 위아래 여백 없이 꽉 참).
- **예약/변경/취소**: `book_slot` / `change_booking` / `cancel_booking` RPC(기존 [0004](../supabase/migrations/0004_booking_rpc.sql), 단일 트랜잭션). 예약/취소 확인=`ConfirmModal`, 변경=`ChangeBookingModal`(후보 슬롯 선택).
- **사전 검증**(`lib/startupBooking.ts` `bookingBlockReason`): 마감·최대 횟수·동일 전문가·시간 충돌을 클라이언트에서 미리 비활성. **최종 권위는 DB RPC `_validate_slot_assignment`.**

**핵심 설계 결정**
- ⭐ **`participantClient` 사용**: 스타트업은 참가자 커스텀 JWT 경로라 모든 쿼리/RPC 를 `participantClient` 로 호출한다(운영진 `supabase` 와 분리). Phase 4 admin 기능과 **클라이언트가 다르다** — Phase 5가 첫 참가자-데이터 기능. RLS(`is_event_participant`/`shares_event_with`/`slots_select`)가 본인 참가 행사로 자동 제한.
- 슬롯 10초 폴링(`PORTAL_POLL_MS`)으로 타 기업의 예약/취소를 근실시간 반영(별도 realtime 인프라 회피).
- 매트릭스 셀 디자인은 관리자 `BookingScheduleTable`과 그리드 스캐폴드(`buildBookingSchedule`)를 공유.
- **신규 마이그레이션 0건**(예약 RPC 기배포) → db push 불필요.

### ✅ 동일 전문가 중복 예약 = 행사 단위 토글 (코드+배포 완료, 2026-06-26)
사용자 요청으로 "동일 전문가 2회 이상(연속 시간 등) 예약" 허용 여부를 **행사 개설/편집 시** 정하도록 했다.

- **DB** [0022_event_allow_duplicate_expert.sql](../supabase/migrations/0022_event_allow_duplicate_expert.sql): `events.allow_duplicate_expert BOOLEAN DEFAULT FALSE` 컬럼 + 중앙 검증함수 `_validate_slot_assignment` 의 "동일 전문가 2회 이상 금지" 규칙만 **토글 OFF 일 때만 차단**하도록 조건화. book/change/admin_force 모든 경로에 일괄 적용. ✅ **db push 완료(Local=Remote 0001~0022).**
- **프론트**: `EventFormModal` 체크박스 + `eventFormSchema`/`EventRow`/`toEventColumns` + 3개 EVENT 컬럼리스트(useEvents/useEventDetail/useStartupPortal) + `bookingBlockReason` 의 `opts.allowDuplicateExpert`(true면 동일 전문가 검사 생략) → `BookingSlotsGrid`/`ChangeBookingModal`/`StartupPortalView` 전파.
- **불변식**: 토글 ON 이어도 **동시간 충돌(스타트업/전문가)·테이블 충돌·최대 상담 횟수는 그대로 차단**(한 사람이 같은 시각에 두 곳에 있을 수 없음). 기본값 OFF = 기존 명세 규칙.
- 검증: lint(0)·typecheck·build·test(**106**, 신규 동일전문가 토글 2) 통과. ✅ **라이브 확인됨(사용자, 2026-06-26)**.

### 🩹 부수 수정 (같은 세션)
- [0021_fix_auth_overview_return_types.sql](../supabase/migrations/0021_fix_auth_overview_return_types.sql): `admin_participant_auth_overview` 가 `/admin/users` 진입 시 400 → `RETURNS TABLE(otp_channel TEXT)` 선언과 실제 `auth_otp_challenges.channel`(VARCHAR) 타입 불일치(42804)가 원인. `::TEXT` 캐스팅으로 해결. ✅ db push 완료. 교훈은 메모리 [[rpc-returns-table-type-match]].
- `App.tsx`: React Router v7 future flag(`v7_startTransition`/`v7_relativeSplatPath`)로 경고 제거.

---

## ⚠️ 미검증(라이브 라운드트립)

- **예약 풀 라운드트립**: 시드 행사를 BOOKING 단계로 두고 스타트업(1회용 로그인 링크 또는 OTP) 로그인 → 예약 신청 → 변경 → 취소까지 RPC 실거동·폴링 공개 반영. (현재 화면 표시·동일 전문가 토글은 확인됨.)

---

## ✅ 슬라이스 2 — 만족도 조사 + 공개 상담 코멘트 (코드+배포 완료, 2026-06-26)

행사 `FINISHED` 단계에서 `StartupPortalView` 가 예약 일정표(`BookingSlotsGrid`) 대신 두 패널을 노출한다.

- **만족도 조사**(`SatisfactionPanel`): 행사 전반·매칭 적절성·운영·재참여를 각 1~5점 세그먼트 척도로 평가 + 자유 의견(최대 1000자). **제출 전=폼 / 제출 후=읽기 전용 요약**. `satisfaction_surveys` INSERT(`participantClient`), RLS `survey_insert_self`(본인·참가행사 WITH CHECK) + `UNIQUE(event_id,user_id)` + UPDATE 정책 없음 → **행사당 1회·수정 불가**. 동시 제출 충돌(`23505`)은 "이미 제출하셨습니다"로 안내. 폼 상태는 로컬 state + `satisfactionSchema.safeParse`(미선택 항목 = '평가를 선택해 주세요.').
- **공개 상담 코멘트**(`PublicCommentsPanel`): 전문가가 공개 허용한 텍스트 코멘트만 표시, **내부 평가 점수는 비공개**.

**핵심 설계 결정 — 점수 비공개 보장(신규 마이그레이션 2건)**
- `clog_select` RLS 는 공개분의 *행*을 노출하므로, 그 행이 노출되면 점수 컬럼까지 SELECT 가능하다(0003_rls.sql 주석의 "노출용 뷰" 미구현 상태). 이를 막기 위해 [0023_public_comments.sql](../supabase/migrations/0023_public_comments.sql) `list_public_comments(p_event_id)` **SECURITY DEFINER RPC**(본인 슬롯·`is_public`·내용 있는 코멘트만, **안전 컬럼만** 반환)로 조회한다 → 점수 컬럼 노출 경로 자체를 차단.
- [0024_revoke_public_comments_anon.sql](../supabase/migrations/0024_revoke_public_comments_anon.sql): Supabase 는 public 스키마 신규 함수 EXECUTE 를 anon 에도 **기본 부여**하므로 `FROM PUBLIC` 회수만으로는 부족 → `anon` 명시 회수(최소 권한). 0023 파일에도 같은 REVOKE 를 반영했으나 *이미 적용된 0023* 은 db push 가 재실행하지 않아 보정용 0024 를 추가.
- 모든 쿼리/RPC 는 **participantClient**(스타트업 커스텀 JWT). 운영진 `supabase` 와 분리.

**신규 파일**: `types/satisfaction.ts`, `lib/satisfaction.ts`(RATING_ITEMS·RATING_SCALE·isValidRating·allRated + test 8), `schemas/satisfactionSchemas.ts`, `hooks/useSatisfaction.ts`(useMySurvey/useSubmitSurvey/usePublicComments), `components/startup/{SatisfactionPanel,PublicCommentsPanel}`. 변경: `StartupPortalView`(FINISHED 분기).

- 검증: `lint`(0)·`typecheck`·`build`·`test`(**114**, 신규 8) 통과.
- **✅ 라이브 배포 완료(2026-06-26)**: `0023`·`0024` `db push`(Local=Remote 0001~0024). anon 스모크: `list_public_comments` anon 호출이 0023 직후 `200 []`(anon 기본 권한 잔존 발견) → **0024 적용 후 `42501 permission denied`** 로 차단 확인(기존 검증된 admin RPC 게이트와 동일 거동).
- **⚠ 라이브 풀 라운드트립 미검증**: FINISHED 시드 행사 + 스타트업 로그인으로 만족도 INSERT·재제출(`23505`) 차단·공개 코멘트 표시.
