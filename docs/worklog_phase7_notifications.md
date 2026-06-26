# Phase 7 작업 로그 — 알림 서비스 (종료 단계)

> Phase 7 는 **자체 개발 가능 항목(없는 것)부터** 진행한다. 외부 서비스 API(실 알림톡/SMS 발송)는
> 공급사 계정·발신번호 등록·템플릿 심사라는 외부 행정 절차가 선행돼야 하므로, 어댑터 인터페이스
> (`supabase/functions/_shared/notifier.ts`)만 준비된 상태로 두고 모킹 기반 인프라를 먼저 완성한다.

## 외부 API vs 자체 개발 분류 (진행 기준)

| 구분 | 항목 |
|------|------|
| 🔴 외부 API 필요 | 실 알림톡(카카오)/SMS 실발송, 실 OTP 발송 — 어댑터만 끼우면 됨(공급사 계정·키·템플릿 필요) |
| 🟢 자체 개발 | 알림 모킹·이벤트 훅·멱등/백오프/실패현황, QR 서명·검증·수동출석, 엑셀(xlsx) 내보내기 |

---

## 슬라이스 1 — 알림 인프라 (모킹 발송 + 이벤트 훅 + 멱등/백오프/실패현황) ✅ 코드+배포 완료 (2026-06-26)

### 설계 (security_transactions.md 4장)
- 예약·상담 트랜잭션을 먼저 완료한 후 알림을 **비동기**로 처리 → 트리거는 `PENDING` 로그 행만 적재(enqueue), 실제 발송은 Cron→Edge 워커가 분리 수행.
- `(event, receiver)` 조합 `idempotency_key` 로 중복 발송 방지.
- 실패 시 **지수 백오프 최대 3회** 재시도, 영구 실패(`FAILED`)는 관리자 화면 노출.
- 초기 개발 = Mock 어댑터, 운영 = Solapi 등 실어댑터로 교체.

### DB — `0034_notification_infra.sql`
- `notification_logs` 테이블은 0001 에서 기생성(idempotency_key UNIQUE / status PENDING|SENT|FAILED / retry_count 0..3 / next_retry_at). RLS 는 0003 `notif_select_admin`(ADMIN SELECT)만.
- `_notif_backoff(retry)` — 1→1분, 2→5분 (3회째 실패는 FAILED 종료).
- `_enqueue_notification(event, receiver, type, idem_key, content)` — SECURITY DEFINER 내부 헬퍼. 채널 도출(휴대폰 있으면 ALIMTALK, 없으면 EMAIL, 둘 다 없으면 적재 안 함) + `ON CONFLICT (idempotency_key) DO NOTHING`. anon/authenticated EXECUTE 회수.
- **이벤트 훅 트리거**:
  - `trg_notify_booking` (`booking_history` AFTER INSERT) — action_type CREATED/CHANGED/CANCELLED → 스타트업(`startup_id`)에게. 멱등키 `booking:<history.id>`(행 1건당 고유).
  - `trg_notify_event_status` (`events` AFTER UPDATE OF status) — status 가 BOOKING 으로 전환되면 참가 STARTUP 전원에게 예약 시작 안내. 멱등키 `event_open:<event>:<user>`.
- **디스패치 RPC (service_role 전용)**:
  - `claim_due_notifications(limit)` — PENDING & 재시도 도래분을 `FOR UPDATE SKIP LOCKED` 로 잠그고 `next_retry_at` 을 2분 뒤로 밀어(가시성 타임아웃) 반환. 동시 워커/크래시 안전.
  - `mark_notification_sent(id)` — SENT 전이.
  - `mark_notification_failed(id, error)` — retry_count++; 3회 도달 시 FAILED, 그 외 `_notif_backoff` 후 PENDING.
- `retry_notification(id)` — ADMIN 가드, FAILED→PENDING 초기화(retry_count=0), `audit_logs` 기록. authenticated 부여.
- **Cron** — Edge 호출(net.http_post)을 Vault 시크릿(`notif_dispatch_url`/`notif_dispatch_secret`)이 **둘 다 설정된 경우에만** 등록(`notification-dispatch-tick`, 1분). vault/pg_net 미가용·미설정 시 `RAISE NOTICE` 후 건너뜀 → 마이그레이션 항상 안전. (실제 push 시 "미설정 — 건너뜁니다" NOTICE 확인.)

### Edge — `supabase/functions/notification-dispatch/index.ts`
- claim → `notifier.ts` 어댑터(Mock/Solapi) send → mark_sent/mark_failed.
- 인가: `NOTIF_DISPATCH_SECRET` 설정 시 `x-dispatch-secret` 헤더 일치 필수(미설정이면 통과 — service_role 베어러 전제). `--no-verify-jwt` 로 배포하고 시크릿으로 게이트.
- `_shared/cors.ts` 에 `x-dispatch-secret` 허용 헤더 추가.

### 프론트
- `types/notification.ts` — NotificationLog/Channel/Status/Type.
- `lib/notification.ts` — `maskDestination`(notifier.ts 와 동일 규칙)·`isRetryable`·`summarizeNotifications`·`statusWeight`·`sortByAttention`(실패·대기 우선) 순수함수.
- `lib/labels.ts` — `NOTIFICATION_STATUS_LABELS`·`NOTIFICATION_TYPE_LABELS`·`notificationTypeLabel` 추가.
- `hooks/useNotifications.ts` — `useEventNotifications`(operator supabase, 15초 폴링) + `useRetryNotification`(retry_notification RPC).
- `components/admin/NotificationLogPanel.tsx` — 상태별 요약 카드 + 발송 로그(상태 배지·종류·채널·마스킹 수신처·본문·재시도 횟수·다음 시도·오류, FAILED 수동 재시도 버튼).
- `views/admin/EventDetailView.tsx` — **"알림 현황" 탭** 추가.

### 검증
- `lint`·`typecheck`·`build`·`test`(**188**, 신규 notification.test.ts 12) 통과.
- **라이브 배포**: `0034` `db push`(Local=Remote 0001~0034) + Edge `notification-dispatch` deploy + `NOTIF_DISPATCH_SECRET` 설정.
- 스모크: 시크릿 무/오답 → `401`, 정답 → `200 {ok, claimed:0, sent:0, failed:0}`(큐 비어 있음 — RPC·grant·mock·mark 체인 도달 확인).

### ⚠ 남은 미완
1. **자동 Cron 활성화** — Vault 시크릿 2건(`notif_dispatch_url`=함수 URL, `notif_dispatch_secret`=설정한 `NOTIF_DISPATCH_SECRET` 값) 등록 후 0034 의 Cron DO 블록을 재실행하면 1분 주기 디스패치 자동화. 현재는 수동 Edge 호출로 디스패치 가능.
2. **라이브 트리거 라운드트립 미검증** — 예약 생성 → `notification_logs` PENDING 적재 → 디스패치 → SENT.
3. **미예약 리마인드** — `BookingStatsPanel` 의 "알림 재발송(준비 중)" 플레이스홀더를 enqueue 연동(후속).

---

## 슬라이스 3 — 엑셀(xlsx) 내보내기 ✅ 코드 완료 (2026-06-26)

### 설계
- 행사 결과를 **시트 5개짜리 xlsx 한 파일**로 다운로드: 예약 현황 / 출석 현황 / 상담 결과 / 만족도 결과 / 참가자 명단.
- `exceljs@4.4.0` 으로 브라우저에서 오프라인 생성(외부 API 아님, 서버 왕복 없음).
- 기존 화면 집계 로직 재사용(`lib/booking`·`lib/attendance`·`lib/counselingReport`·`lib/surveyReport`) — "엑셀 시트 표 구조" 포장만 추가.

### 신규 파일
- `lib/excel.ts` — 범용 워크북 빌더(`SheetSpec[]`→xlsx ArrayBuffer)·Blob 다운로드 I/O 래퍼. 머리글 굵게·열너비·머리글 고정(frozen row).
- `lib/eventExport.ts` — 순수 함수: `buildBookingSheet`·`buildAttendanceSheet`·`buildCounselingSheet`(동적 문항 열 펼침)·`buildSurveySheet`(역할 접두사 문항 열)·`buildParticipantSheet`(연락처 명단) + `buildEventExportSheets`(5탭 조립) + `exportFilename`(금지문자 치환). `SheetSpec`/리포트 타입은 `import type`(런타임 의존 없음 → 테스트에 exceljs 미로딩).
- `hooks/useEventExport.ts` — operator supabase. 버튼 클릭 시 슬롯·테이블·참가자(연락처)·출석 로그·상담 문항/일지·만족도 문항/응답을 병렬 조회(`Promise.all`)해 번들 구성→워크북→다운로드. ADMIN RLS 테이블 직접 SELECT(상담/만족도 리포트와 동일 경로).

### UI
- `views/admin/EventDetailView.tsx` — 탭 행 우측에 **"엑셀 내보내기" 버튼**(생성 중 비활성·실패 시 Alert).

### 검증
- **신규 마이그레이션 없음**(기존 테이블 조회) → DB 배포 불필요.
- `lint`·`typecheck`·`build`·`test`(**197**, 신규 eventExport.test.ts 9) 통과. exceljs 추가로 번들 커짐(빌드 경고, 동작 무관).
- ⚠ 라이브 미검증: 관리자 로그인 + 데이터 있는 행사에서 실제 파일 다운로드/시트 내용.

---

## 슬라이스 2 — QR 출석 (30초 서명 토큰 + 수동 출석) — ⏸ 애드온으로 보류
사용자 결정으로 추후 진행. 30초 만료 HMAC 서명 토큰(참가자 휴대폰 QR 제시 → 스태프 스캔 검증 → `attendance_logs.check_in_type='QR'`). 수동 체크인 기반(`check_in`/`clear_attendance`, 0019/0020)은 이미 존재.
