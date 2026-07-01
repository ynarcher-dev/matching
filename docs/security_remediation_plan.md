# 보안 보완·리스크·취약점 조치 계획 (Remediation Plan)

작성일: 2026-07-01
근거 문서:
- [서비스 전체 보안 감사 메모](./security_service_audit.md) (이하 **감사**)
- [서비스 보안 감사 추가 보완 메모](./security_service_audit_supplement.md) (이하 **보완**)

---

## 작업 전 인지사항 (비개발자용 요약)

이 문서는 보안 감사에서 나온 항목을 정리한 작업 목록이다. 현재 상태를 먼저 요약하면, **개발자가 바로 고칠 수 있는 코드/SQL 보안 조치(A 그룹)는 모두 완료된 상태**다. CSV/엑셀 수식 주입, 파일 저장 경로 우회, 업로드 용량 제한, 알림 디스패치 인증, 사용자 URL 검증, 사진 EXIF 제거, 의존성 취약점 등은 이미 조치되었고 테스트 또는 마이그레이션 적용 확인까지 기록되어 있다.

지금 남아 있는 대기항목(B 그룹)은 대부분 "코드 버그"라기보다 **서비스 운영 정책을 먼저 정해야 하는 보안 이슈**다. 예를 들어 누가 긴급 로그인 링크를 발급할 수 있는지, 일반 ADMIN과 super_admin의 권한을 어떻게 나눌지, 참가자 로그인에 OTP를 도입할지, 어떤 운영 도메인만 CORS로 허용할지 같은 결정이 필요하다. 이 결정 없이 바로 개발하면 실제 운영 흐름을 막거나, 반대로 너무 느슨한 권한을 코드로 고착시킬 수 있다.

다른 에이전트가 이어서 작업할 때는 아래 순서를 권장한다.

1. **먼저 E-1 확인**: `notification-dispatch`는 코드가 fail-closed로 바뀌었기 때문에, 배포 전에 `NOTIF_DISPATCH_SECRET`과 Cron vault 시크릿이 같은 값으로 설정되어 있어야 한다. 이 값이 없으면 알림 발송이 503으로 멈출 수 있다.
2. **그다음 B-7, B-8, B-9부터 결정**: CORS 허용 도메인, 긴급 로그인 링크 발급 권한, 일반 ADMIN/super_admin 권한표는 비교적 빨리 닫을 수 있으면서 위험도가 높은 항목이다.
3. **B-1, B-2, B-4는 정책/UX 영향이 큼**: 참가자 2차 인증, JWT 저장소 전환, 개인정보 조회범위 축소는 보안상 중요하지만 로그인 UX와 화면 데이터 범위가 바뀔 수 있으므로 사용자 결정이 선행되어야 한다.

즉, 남은 작업은 "개발을 못 해서 남은 것"이 아니라 **운영 원칙이 확정되어야 안전하게 개발할 수 있는 것**에 가깝다. 다음 작업자는 각 B 항목을 바로 구현하기 전에 문서에 적힌 "물어볼 질문"에 대한 답을 먼저 받아야 한다.

---

## 0. 이 문서 사용법

- 이 계획은 **대규모 작업**이다. 인증/세션, Edge Function/CORS, RLS, Storage, CSP/헤더, 의존성 6개 축에 걸쳐 있다.
- 항목은 두 그룹으로 나눈다.
  - **A. 바로 진행 (Do)** — 순수 코드/SQL 수정으로 완결되고, 제품·UX 결정이 이미 서 있는 항목. 에이전트가 단독으로 안전하게 처리 가능.
  - **B. 보류·재확인 (Hold)** — 인프라 시크릿 값, 외부 서비스 연동, 로그인/세션 아키텍처 전환, RLS 업무범위 축소처럼 **사용자 결정이 선행되어야** 하는 항목. 각 항목에 "물어볼 질문"을 명시한다.
- 진행 방식: 사용자가 "N번 하자"고 지목하면, 에이전트는 **그 항목 하나만** 작업 → 더블체크 → 메모리 기록 → 대화 종료. 새 대화에서 다음 항목 진행.
- 각 항목의 체크박스: `[ ]` 미착수 · `[~]` 진행중 · `[x]` 완료(더블체크+메모리 기록까지 끝난 상태).

---

## A. 바로 진행 (Do) — 코드/SQL로 완결

> 아래는 UX·업무 로직을 바꾸지 않으면서 방어를 더하는(fail-closed, guard 추가) 항목들이다. 순수 코드 작업이므로 지목 즉시 진행 가능.

### A-1. `[x]` CSV/XLSX Formula Injection 가드 (감사 F-1, P0)
> 완료(2026-07-01): `src/lib/exportSafety.ts`의 `sanitizeCell()` 신설 → `toCsv`(surveyReport.ts, 모든 CSV 경로 수렴)와 `buildWorkbookBuffer`(excel.ts, 모든 XLSX 경로 수렴)에 결합. `=`/`+`/`-`/`@`/TAB/CR 접두 문자열에 `'` prefix. 테스트 `src/test/exportSafety.test.ts`(=HYPERLINK/+1+1/@SUM/=1+1 검증) 통과, tsc OK.
- **대상**: `src/lib/surveyReport.ts`(`toCsv`), `src/lib/excel.ts`(ExcelJS 셀), 그 외 내보내기 경로.
- **작업**: 문자열 셀이 `=`, `+`, `-`, `@`, TAB(0x09), CR(0x0D)로 시작하면 앞에 `'` prefix. 공통 `sanitizeCell()` 유틸로 통일.
- **완료 기준(테스트)**: `=HYPERLINK("...")`, `+1+1`, `@SUM(1,1)`, `=1+1` 이 수식으로 저장되지 않음.
- **위험도/영향**: 낮음(출력 문자열만 변경). 회귀 위험 최소.

### A-2. `[x]` Storage 경로 소유자 파싱 우회 차단 (보완-01, High, P1)
> 완료(2026-07-01): `0076_storage_owner_path_strict.sql` — depth-1 전용 엄격 추출기 `_storage_owner_id_strict(name)`(폴더 세그먼트 정확히 1개일 때만 소유자 반환, 0·2+ 개는 NULL) 신설. `proposals_read/write/update/delete`, `avatars_write/update/delete` 정책을 DROP+CREATE 로 재생성해 엄격 추출기 사용 + 소유자 본인 쓰기 분기에 `starts_with(name, uid||'/')` 앵커 결합. 공격 경로 `{victim}/{attacker}/x.pdf`(length 2)는 strict NULL→거부, 정상 depth-1 경로는 통과. 전역 `_storage_owner_id`는 event-photos(depth-2)용이라 미변경. `supabase db push` 성공. 다음=A-6.
- **대상**: `supabase/migrations/0067_fix_storage_owner_id.sql`의 `_storage_owner_id`, 관련 RLS(`proposals_*`, `avatars_*`).
- **작업**: 경로가 `{owner_uuid}/...` 포맷에 엄격히 일치하도록 정규식 검증. RLS `WITH CHECK`에 `starts_with(name, current_app_user_id()::text || '/')` 직접 결합. 깊이 우회(`victim/attacker/x.pdf`) 무력화.
- **완료 기준**: `{victim}/{attacker}/x.pdf` 경로 업로드/조회가 RLS에서 거부됨. 기존 정상 경로(`{userId}/{uuid}.pdf`, `{userId}/avatar.ext`)는 통과.
- **주의**: 기존 저장 경로 포맷을 반드시 먼저 검증(현 코드 기준 `{userId}/...` 단일 depth이므로 안전).

### A-3. `[x]` Storage 업로드 용량 제한 RLS 강제 (보완-02, Medium-High, P2)
> 완료(2026-07-01): `0078_storage_file_size_limit.sql` — 3개 버킷에 `storage.buckets.file_size_limit`(바이트) 설정. proposals=10485760(10MB), avatars=52428800(50MB), event-photos=8388608(8MB). 값은 클라이언트 한도와 일치(storage.ts PROPOSAL_MAX/AVATAR_MAX, companyPhoto.ts PHOTO_MAX_BYTES). RLS `metadata->>'size'` 방식 대신 버킷 file_size_limit 채택 이유: 객체 row INSERT 이전에 Content-Length 로 Storage API 가 서버측 선검증(413) → INSERT 시점 metadata 채워짐 여부(버전 의존) 무관, RLS churn 없음. 기존 write RLS 미변경. `supabase db push` 성공, `migration list --linked`에서 0078 원격 적용 확인. 버킷 id(proposals/avatars=0007, event-photos=0036) 실재 확인 → UPDATE 정상 매칭. 다음=A-7.
- **대상**: `0007_storage.sql`, `0036_company_photos.sql`의 write RLS + 버킷 설정.
- **작업**: RLS `WITH CHECK`에 `(metadata->>'size')::bigint < <limit>` 결합, 또는 `storage.buckets.file_size_limit` 설정. proposals 10MB, avatars 50MB, event-photos 별도 값.
- **완료 기준**: 한도 초과 업로드가 서버에서 거부됨.
- **주의**: 클라이언트 한도(`storage.ts`: proposals 10MB / avatars 50MB)와 값 일치시킬 것.

### A-4. `[x]` company_photos INSERT에 행사범위(can_staff_event) 검증 추가 (보완-04, Medium, P2)
> 완료(2026-07-01) — **선반영 확인, 신규 마이그레이션 불필요**. 이 항목이 요구한 변경은 이미 `0042_event_scope_rls.sql`에서 적용되어 있었다. 계획서가 `0036` 시점 상태를 기준으로 작성되어 0042의 선반영을 놓친 것이 원인. 실제 검증:
> - **마이그레이션 순서 추적**: `company_photos` 정책을 건드리는 파일은 `0036`(생성) → `0042`(재범위화) → `0045`(스토리지)뿐이며, 이후 `0046~0077` 어디서도 재변경 없음. `company_photos_insert`의 **마지막 정의는 0042**.
> - **0036 상태(문제)**: `WITH CHECK ( is_admin_or_staff() AND uploaded_by=본인 AND EXISTS(STARTUP 참가자) )` — 행사 스코프 없음(전역 스태프면 미배정 행사에도 INSERT 가능).
> - **0042 상태(해소)**: 동일 정책을 DROP+CREATE로 재정의하며 `is_admin_or_staff()` → **`public.can_staff_event(event_id)`** 로 교체. `company_photos_update`도 `can_staff_event`로 전환. (물리 DELETE 정책은 미존재 = soft delete만 허용, 원안 유지.)
> - **0045 상태**: 스토리지 `event-photos` 버킷 객체 정책도 `can_staff_event(_event_photo_event_id(name))`로 맞춰 **Storage RLS ↔ DB RLS 불일치까지 해소**됨.
> - **라이브 확인**: `supabase migration list` 결과 원격이 `0077`까지 전부 적용 상태 → 0042/0045가 라이브에 반영됨. 마이그레이션은 사전순 결정적 적용이므로 라이브 `company_photos_insert` = 0042 정의(= `can_staff_event` 포함).
> - **완료 기준 충족**: `can_staff_event`는 super_admin 또는 해당 행사 OWNER/MANAGER/STAFF만 TRUE → 미배정 행사에 스태프가 사진행 INSERT 시 WITH CHECK 실패로 거부. ✅
- **대상**: `0036_company_photos.sql`의 `company_photos_insert` (필요 시 update/delete도).
- **작업**: `WITH CHECK`에 `public.can_staff_event(event_id)` 추가. Storage RLS(0045)와 DB RLS 불일치 해소.
- **완료 기준**: 미배정 행사에 STAFF가 사진행 INSERT 시 거부.

### A-5. `[x]` emergency-login Edge Function Rate Limit (보완-07, Low-Medium)
> 완료(2026-07-01): `0077_emergency_login_rate_limit.sql` — `consume_emergency_login_token`을 `(TEXT)`→`(TEXT, p_ip_hash TEXT DEFAULT NULL)`로 재정의(기존 1-인자 DROP 후 재생성, 오버로드 모호성 방지). `participant-login`과 **동일 패턴·동일 집계 테이블**(`participant_login_attempts`) 재사용: 동일 IP 10분 20회 실패 초과 시 `THROTTLED`. 유효 토큰 소비는 `succeeded=TRUE`라 실패 카운트 미포함(정상 현장 운영 방해 없음), 해시불일치/비활성유저/재사용경합 3개 INVALID 경로에 실패행 INSERT. Edge(`emergency-login/index.ts`)에 `hashIp()`(participant-login 동일 로직) 추가 → `p_ip_hash` 전달, `THROTTLED→429`(`too_many_attempts`, retry_after) 매핑. `supabase db push` 성공. 프론트(authStore.consumeEmergencyToken)는 429를 기존 4xx 분기로 안전 처리(generic 안내, 정보 누출 X). rate limit은 `OTP_IP_SALT` 설정 시에만 활성(participant-login과 동일 전제). 다음=A-4.
- **대상**: `supabase/functions/emergency-login/index.ts`.
- **작업**: IP 해시 기반 rate limiter(예: 동일 IP 10분 20회). 기존 `participant-login`의 rate limit 패턴 재사용.
- **완료 기준**: 임계 초과 시 429. 가짜 토큰 대량 호출로 DB 커넥션 고갈 불가.

### A-6. `[x]` notification-dispatch 무인증 허용 제거 (감사 B-2, P0)
> 완료(2026-07-01): `authorize()`를 fail-closed로 전환 — `NOTIF_DISPATCH_SECRET` 미설정 → **503**(`secret_not_configured`), 헤더 불일치 → **401**(`secret_mismatch`), 일치 → 통과. `callerInfo()`로 IP(x-forwarded-for/x-real-ip)·UA 파싱, 거부 시 `console.warn`, 성공 배치 종료 시 `console.log`(ip/provider/claimed/sent/failed). 호출부는 Cron(0034, `x-dispatch-secret` 전송)뿐이며 프론트는 `notification-dispatch` 직접호출 없음. Deno 미설치로 로컬 타입체크는 불가(논리검증). ⚠️ **배포 전 필수**: 프로덕션 함수 env `NOTIF_DISPATCH_SECRET` 설정 + Cron vault `notif_dispatch_secret` 동일 값 세팅(현재 사용자: 미설정/불확실 상태 → 배포 시 발송 503 주의).
- **대상**: `supabase/functions/notification-dispatch/index.ts`의 `authorize()`.
- **작업**: `NOTIF_DISPATCH_SECRET` 미설정 시 `true` 반환 → **503(fail-closed)**. 호출 IP/UA/batch 결과 로깅.
- **완료 기준**: 시크릿 없이 호출 시 503, 잘못된 시크릿 401.
- **⚠️ 운영 연동**: 배포 환경에 `NOTIF_DISPATCH_SECRET`을 실제로 설정해야 정상 발송 유지됨 → **작업 시 사용자에게 "시크릿 설정 완료 여부" 1줄 확인**. (코드는 fail-closed가 정답이므로 A로 둠)

### A-7. `[x]` 사용자 URL 서버측 검증 (감사 E-1, P1)
> 완료(2026-07-01): `0079_public_url_validation.sql` + `0080_public_url_validation_fix.sql`. 공통 헬퍼 `public._validate_public_url(TEXT)`(IMMUTABLE) 신설 → 유효 시 정규화 URL 반환, 아니면 RAISE. **scheme allow-list**: http/https만, `javascript:`/`data:`/`file:`/`vbscript:`/`mailto:` 등 거부, scheme 없으면 `https://` prepend(프론트 normalizeUrl과 동일 규칙). **host 차단**: localhost/*.localhost/*.local, IPv4 loopback·사설·link-local·this-net(127/8,10/8,172.16/12,192.168/16,169.254/16,0/8), IPv6 loopback/unspecified/IPv4-mapped/ULA(fc00::/7)/link-local(fe80::/10). 제어문자·공백 거부. userinfo(`user:pass@`)는 마지막 @ 뒤를 host로 취해 `…@evil@127.0.0.1` 우회 차단. 이 헬퍼를 `add_my_company_link`·`set_my_company_homepage`에 결합(두 RPC가 유일한 사용자 URL 쓰기 경로 — company_links는 SELECT RLS만이라 직접 INSERT default-deny). **현행 추적(A-4 교훈)**: 두 RPC 최신 정의는 0073/0066이며 기존 검증 전무 확인. **더블체크**: Postgres POSIX ERE와 동일한 JS 정규식 에뮬레이션으로 36개 케이스 전수 통과(위험 스킴 거부, 사설/로컬 차단, userinfo 우회 차단, public host·public IPv6 허용). **0080 교정**: 0079가 IPv6 fc/fd/fe8~feb 규칙을 모든 host에 적용해 정상 도메인(fdj.fr·fcbarcelona.com·febreze.com)을 오탐 차단하던 버그를 콜론 포함 IPv6 리터럴에만 적용하도록 게이트. 기존 저장 행(0073 백필분)은 소급 미검증(정상 http 링크 손상 방지). `supabase db push` 2회 성공. 다음=A-10.
- **대상**: RPC `add_my_company_link`, `set_my_company_homepage`(`0073_company_links.sql` 등), 프론트 `normalizeUrl()`.
- **작업**: 서버 RPC에서 scheme allow-list(`https:` 우선, `http:` 정책 결정), `data:`/`file:`/`javascript:` 차단, `localhost`·사설IP(10/8, 172.16/12, 192.168/16, 127/8)·link-local·IPv6 local 차단.
- **완료 기준**: 감사 §5-7 케이스가 서버에서 차단/정규화됨.
- **참고**: `http:` 허용/경고 정책만 B-과 겹치면 그때 확인(대개 https 강제 + http 차단으로 진행 가능).

### A-8. `[x]` event-photos EXIF 메타데이터 제거 (보완-06, Low-Medium)
> 완료(2026-07-01): **현행 추적(A-4 교훈)** — 업로드 경로는 `useCompanyPhotos.upload` → `resizeImageFile`(companyPhoto.ts)뿐. **성공 경로는 이미 EXIF 없음**: `createImageBitmap`→canvas→`toBlob('image/jpeg')`는 픽셀만 재인코딩하므로 GPS/기기 EXIF가 남지 않음(스케일=1인 소형 이미지도 재인코딩됨). **유일한 누출은 폴백 3곳**(`!ctx`·`toBlob→null`·`catch`)에서 원본 파일(EXIF 포함)을 그대로 반환하던 것. 폴백에서 사진을 버리면 업로드 실패(UX 저하)라 원본을 유지하되 EXIF만 제거: 순수 함수 `stripJpegMetadata(bytes)` 신설 — JPEG 마커를 순회해 APP1(Exif/XMP)~APP15와 COM(주석) 세그먼트 제거, JFIF(APP0)·DQT·SOF·엔트로피 데이터는 보존, SOS 이후 원본 복사, 비-JPEG/파싱실패는 `null`(원본 유지). `stripImageMetadata(file)`가 JPEG일 때만 적용해 폴백에 결합. **더블체크**: vitest 3케이스(APP1 GPS·COM 제거 확인, JFIF/DQT/SOS/엔트로피/SOI/EOI 보존 확인, 비-JPEG null) 통과, 전체 314 테스트·tsc·eslint 클린. 다음=A-11.
- **대상**: 스태프 사진 업로드 경로(`CompanyPhotoUploadPanel.tsx` + 리사이즈 유틸).
- **작업**: 클라이언트 canvas 재인코딩 과정에서 EXIF strip. 이미 canvas 리사이즈 중이면 사실상 제거됨 → **현 구현 먼저 확인** 후 필요 시 강제.
- **완료 기준**: 업로드 결과물에 GPS/기기 EXIF 없음.

### A-9. `[x]` exceljs / transitive uuid 취약점 해소 (감사 I-1, P2)
> 완료(2026-07-01): moderate 취약점 `uuid<11.1.1`(GHSA-w5hq-g745-h8pq, v3/v5/v6에 `buf` 인자 제공 시 버퍼 경계검사 누락)은 `exceljs@4.4.0`(최신)이 `uuid ^8.3.0`을 물어 `uuid@8.3.2`로 해소되며 유입. **실사용 노출 없음**: exceljs는 `uuid.v4()`(버퍼 인자 없이)만 사용(`lib/xlsx/xform/.../cf-rule-ext-xform.js`의 `{${uuidv4()}}`) → 취약 경로(v3/v5/v6+buf) 미도달. exceljs 최신이 이미 4.4.0이라 **업그레이드로는 해소 불가**(npm 제안 fix는 exceljs 3.4.0 다운그레이드 = 부적절). **조치**: `package.json`에 중첩 override `{"exceljs":{"uuid":"^11.1.1"}}` 추가 → tree의 uuid를 11.1.1로 승격(전역 override 대신 exceljs 하위로 한정, 다른 트리 영향 0). **더블체크**: `npm audit --omit=dev` → **0 vulnerabilities**(완료기준 충족). full audit 잔여 5건(3 moderate/1 high/1 critical)은 전부 esbuild/vite/vitest **dev 툴체인**이라 범위 밖(계획서 "npm audit CI는 별도"). 회귀검증: uuid v11 CJS `require('uuid').v4` 함수 정상·유효 UUID 생성 확인, `new ExcelJS.Workbook()` writeBuffer 정상(6378 bytes), tsc·314 테스트 통과. lint 잔여 2건은 무관 파일의 선재 max-lines 경고. **주의(브라우저)**: Vite는 exceljs `browser` 필드(`dist/exceljs.min.js`, uuid v8 인라인 번들)를 사용 → override는 런타임 번들을 바꾸지 않고 audit 대상 node_modules tree만 정리(런타임은 v4-only라 원래 안전). **A그룹 마지막 항목 완료** → 다음은 B그룹(사용자 결정 선행) 또는 배포 전 E-1(A-6 시크릿 세팅).
- **대상**: `package.json`, lockfile.
- **작업**: `exceljs` 최신에서 취약 `uuid<11.1.1` 해소 여부 확인 후 업그레이드. 안되면 override/대안 검토. `npm audit` CI 추가는 별도.
- **완료 기준**: `npm audit --omit=dev`에서 해당 moderate 해소.

### A-10. `[x]` 알림 상태전이 루프 중복발송 가드 (보완-05, Medium)
> 완료(2026-07-01): `0081_notification_receiver_quota.sql`. **현행 추적(A-4 교훈)**: `_enqueue_notification` 최신 정의는 0038(0037→0038 재정의, 0065는 UI 토글 컬럼만). **부분 선충족 확인**: 보완-05가 지목한 정확한 벡터인 `EVENT_BOOKING_OPEN`은 멱등키 `event_open:{event_id}:{user_id}`가 (행사,수신자)당 고정이라 `idempotency_key UNIQUE`(0001) + `ON CONFLICT DO NOTHING`으로 **DRAFT↔BOOKING 반복 토글해도 수신자당 1행만 적재** → 완료기준("상태 반복 전이해도 동일 타입 1회만 적재") 이미 충족(코드 변경 불필요). **남은 공백 보완**: `_notify_booking_event`는 `booking:{booking_history.id}`로 액션 행마다 새 키 → 예약 생성/취소 루프나 향후 비멱등 타입은 무제한 적재 가능. 감사 권고의 "수신자별 quota"를 0038 로직 전부 보존한 채 추가: 동일 (행사,수신자) 최근 1시간 내 적재 30건 이상이면 새 적재 skip(RAISE NOTICE). 임계 30은 정상 운영(EVENT_BOOKING_OPEN 1회 + 본인 예약 액션 소수)을 크게 상회 → UX 무영향. quota 카운트는 (행사,수신자) 기준이라 참가자 N명 fan-out(각 수신자 count=1)은 미발동. 가속용 `idx_notif_event_receiver_created(event_id,receiver_id,created_at)` 추가. `supabase db push` 성공, `migration list --linked` 0081 로컬·원격 적용 확인. 다음=A-8.
- **대상**: `_enqueue_notification` / `trg_notify_event_status`(`0034`, `0037` 계열).
- **작업**: 동일 (행사, 수신자, 알림타입) 발송 이력 존재 시 재적재 skip, 또는 수신자별 quota. `DRAFT↔BOOKING` 토글 남용 시 중복 폭증 차단.
- **완료 기준**: 상태 반복 전이해도 동일 타입 알림 1회만 적재.
- **주의**: 정당한 재발송 요구가 있는지 가벼운 확인 필요하나, "동일 타입 1회" 기본값은 안전하므로 A로 둠.

### A-11. `[x]` event_operator_roles 조회용 관리 RPC (감사 C-2, 운영 편의)
> 완료(2026-07-01): `0082_list_event_operators.sql` — `list_event_operators(p_event_id UUID)` SECURITY DEFINER RPC 신설. **RLS 확대 없이** 방어. 문제: 0039 `event_operator_select` RLS 는 최고관리자·"본인 행"만 노출 → 비 최고관리자 MANAGER 는 자기 관리 행사의 운영자 목록을 못 봄(본인 1행만). 0064 테이블 현장 담당자(set_table_manager) 후보 풀이 MANAGER 화면에서 비어 보이는 문제(0064 NOTE)의 정식 해소. **게이트**: `WHERE public.can_manage_event(p_event_id)`(행에 무관한 상수 boolean) → 관리권한(최고관리자 또는 OWNER/MANAGER) 없으면 전체 FALSE → 0건(권한 밖 행사 빈 결과), 있으면 그 행사 활성 운영자(revoked 아님) 전체를 users LEFT JOIN 해 name/email 포함 반환. SECURITY DEFINER 내부에서도 `current_app_user_id()`는 정의자 아닌 **호출자 JWT**로 해석(모든 can_* 헬퍼가 RLS 에서 의존하는 동일 패턴)이라 게이트가 실제 호출자를 반영. **프론트**: `useEventOperators`(useOperators.ts)를 직접 테이블 select→RPC 호출로 교체(권한판정 UI 는 참고용 유지). 소비처 `EventTablesPanel`·`ProgressDashboardPanel`(무조건 eventId 로 호출)에서 MANAGER 가 이제 담당자 풀을 정상 조회. 최고관리자는 `can_manage_event` 항상 TRUE → 기존 RLS 조회와 동일 집합(정렬만 name 순, 소비처가 재정렬/Map 사용해 무영향)이라 `EventFormModal`·`EventOperatorAssignModal`·`EventDetailView`(super 게이트) 회귀 없음. **더블체크**: tsc·eslint 클린, `db push` 성공, `migration list --linked` 0082 로컬·원격 적용 확인. 다음=A-9(마지막 A 항목).
- **대상**: `0039_event_operator_roles.sql`, `0064_table_manager.sql`.
- **작업**: `can_manage_event(event_id)` 범위에서 해당 행사 운영자 목록을 읽는 `SECURITY DEFINER` RPC 추가(RLS 확대 없이). 프론트 권한판정은 참고용 유지.
- **완료 기준**: MANAGER가 담당자 목록을 정상 조회, 권한 밖 행사는 빈 결과.

---

## B. 보류·재확인 (Hold) — 사용자 결정 선행

> 아래는 **제품/운영 정책**이나 **인프라 값·외부 연동**이 정해져야 손댈 수 있다. 지목 시, 에이전트가 먼저 질문 → 답 확정 → 작업.

### B-1. `[ ]` 참가자 로그인 2차 인증 도입 (감사 A-1, P0)
- **쟁점**: 이름+전화 단독 로그인은 약함. OTP / 1회용 코드 / 행사별 초대 토큰 중 택1.
- **물어볼 질문**:
  1. 2차 인증 방식? (SMS OTP / 이메일 코드 / 행사 초대링크 / "지금은 rate-limit 강화만")
  2. SMS OTP면 Solapi 예산·발송 감내 가능?
- **부분 진행 가능**: 아키텍처 결정 없이도 **복합 rate-limit(phone/name+phone/user/IP)** + `OTP_IP_SALT` 필수화는 먼저 가능(원하면 A로 승격).

### B-2. `[ ]` 참가자 JWT 저장소 전환 localStorage → HttpOnly 쿠키/메모리 (감사 A-2, P1)
- **쟁점**: XSS 시 토큰 탈취. 쿠키 세션 전환은 Edge Function/CSRF/새로고침 UX에 큰 영향.
- **물어볼 질문**:
  1. HttpOnly 쿠키 전면 전환(권장·공사 큼) vs sessionStorage+짧은 TTL+idle timeout(중간) vs memory-only?
  2. 새로고침 시 재로그인 UX 허용 범위?

### B-3. `[ ]` 운영자 임시비밀번호 반환 제거 + 최고관리자 MFA (감사 A-3, P2)
- **쟁점**: 임시 비번을 이메일 초대 링크 발송으로 전환하려면 메일 인프라 필요. MFA는 Supabase Auth 정책.
- **물어볼 질문**:
  1. 이메일 초대 발송 인프라(SMTP/Solapi 메일) 준비됨?
  2. MFA 강제 도입 시점? 최근 재인증(re-auth) UX 넣을지?

### B-4. `[ ]` users/proposals/avatars RLS 업무범위 축소 (감사 C-1, P1)
- **쟁점**: "같은 행사 전체 조회"를 "업무상 필요한 관계"로 좁히면 화면 데이터가 바뀜. 역할별 view/RPC 설계 필요.
- **물어볼 질문**:
  1. 스타트업이 볼 전문가 필드 범위? (이름/소속/직책/분야/사진만?)
  2. 전문가가 볼 스타트업 범위? (배정 슬롯 한정?)
  3. 스타트업↔스타트업 상호조회 완전 차단해도 되나? (현재 `0074_company_links_coparticipant_read` 존재 — 의도된 기능인지 확인)

### B-5. `[ ]` 파일 업로드 서버측 검증/스캔 (감사 D-1, P1)
- **쟁점**: Edge Function 중계 or Storage trigger로 magic byte/MIME 검증, 멀 웨어 스캔. 인프라 규모 큼.
- **물어볼 질문**:
  1. 어디까지? (magic byte 검증만 / 풀 백신 스캔 파이프라인)
  2. 업로드 경로를 Edge Function 중계로 바꿔도 되나(현재 클라이언트 직접 업로드)?

### B-6. `[ ]` CSP·보안 헤더 배포 설정 (감사 E-2, P1)
- **쟁점**: 헤더는 배포/호스팅 계층 설정. 어디에 배포하는지 모름. CDN 폰트(jsDelivr Pretendard) self-host or SRI 결정 필요.
- **물어볼 질문**:
  1. 배포 호스팅? (Vercel / Netlify / Nginx / Cloudflare / 기타) — 헤더 설정 위치 결정.
  2. Pretendard 폰트 self-host로 전환 OK? (아니면 SRI만)

### B-7. `[ ]` CORS ALLOWED_ORIGIN 필수화 (감사 B-1, P0)
- **쟁점**: fail-closed로 바꾸면 실제 운영 origin 값이 있어야 서비스 동작.
- **물어볼 질문**:
  1. 운영/스테이징 도메인 목록(allow-list)?
  2. 미설정 시 함수 실패 처리 OK? (배포 전 시크릿 세팅 조건)
- **참고**: 값만 확정되면 즉시 A로 승격 가능.

### B-8. `[ ]` 긴급 로그인 링크 발급 권한 축소 (감사 G-2, P0)
- **쟁점**: `issue_emergency_login_token`을 `is_super_admin()` 또는 행사 OWNER/MANAGER로 축소하면 현재 일반 ADMIN 운영 흐름이 막힐 수 있음.
- **물어볼 질문**:
  1. 일반 ADMIN이 긴급 링크를 발급해야 하는 실제 운영 상황이 있나?
  2. "발급자=해당 행사 관리권한 보유 + 대상=그 행사 참가자"로 제한해도 업무 문제 없나?

### B-9. `[ ]` 전역 사용자/분야 관리 RLS를 super_admin으로 축소 (감사 G-1, P2)
- **쟁점**: `users_insert_admin`/`users_update_admin`/`fields_write_admin`이 `current_app_role()='ADMIN'` 허용. UI는 SuperAdmin 보호이나 API 직접호출 우회 가능. "ADMIN vs super_admin" 권한표 확정 필요.
- **물어볼 질문**:
  1. 일반 ADMIN이 전역 참가자/분야 DB를 수정할 정당한 사유가 있나? 없으면 `is_super_admin()`으로 축소.
  2. 권한표(super_admin/owner/manager/staff/viewer/startup/expert) 문서화 착수해도 되나?

### B-10. `[ ]` 관리자/스태프 세션 session_version 검증 통일 (보완-03, Medium, P2)
- **쟁점**: Supabase Auth JWT엔 `session_version`이 없음. 넣으려면 **Custom Access Token Hook**(Auth 훅) 인프라 필요.
- **물어볼 질문**:
  1. Supabase Custom Access Token Hook 사용 가능한 플랜/설정인가?
  2. 대안(짧은 JWT TTL + refresh 시 재검증)으로 갈지?

### B-11. `[ ]` 알림 내용 템플릿 검증·자유본문 승인 (감사 H-1)
- **쟁점**: 자유본문 발송 권한/승인 로그, destination 마스킹 정책.
- **물어볼 질문**:
  1. 자유본문 발송 기능이 실제 존재/필요? 템플릿 전용으로 강제 가능?

### B-12. `[ ]` 파일 열람 감사 로그 (감사 D-2, P2)
- **쟁점**: `file_access_logs` 스키마 추가 + 기록 지점 삽입. 소규모지만 저장/조회 정책 결정 필요.
- **물어볼 질문**:
  1. 별도 테이블로 남길지, 기존 `audit_logs` 재사용할지? 보존기간?

---

## C. 권장 실행 순서

1. **1차 (순수 코드, 저위험 P0/High 먼저)**: A-1 → A-2 → A-6 → A-5 → A-4 → A-3
2. **2차 (코드, 중위험)**: A-7 → A-10 → A-8 → A-11 → A-9
3. **3차 (결정 후 착수)**: B-7 → B-8 → B-9 (권한/CORS — 값·정책만 정하면 빠름)
4. **4차 (아키텍처 공사)**: B-1 → B-4 → B-2 → B-5 → B-6 → B-3 → B-10 → B-11 → B-12

> 순서는 권장일 뿐, 사용자가 지목하는 항목을 우선한다.

---

## C-특이. 진행 중 발견된 특이사항 로그

> 계획 실행 중 확인된 사실 중, 계획서 원안 가정과 달랐던 항목을 기록한다.

### 2026-07-01 · A-4는 이미 선반영 상태였음 (신규 작업 0건)
- **발견**: A-4(`company_photos` INSERT 행사범위 검증)가 요구한 `can_staff_event(event_id)` 결합은 이미 `0042_event_scope_rls.sql`에서 완료되어 있었다(스토리지 정합까지 `0045`에서 완료). 계획서는 `0036` 시점 상태를 근거로 작성되어 이 선반영을 반영하지 못했다.
- **조치**: 중복 마이그레이션을 새로 만들지 않았다(동일 정책 재-DROP/CREATE는 불필요한 churn·회귀 위험). A-4를 `[x]`로 갱신하고 근거를 항목에 기록.
- **일반화된 교훈(남은 항목 진행 시 주의)**: 운영자 권한 범위화 작업(`0039`~`0045` 계열)이 보안 감사 항목 일부를 **이미 선반영**했을 수 있다. 남은 A/B 항목을 착수하기 전, 반드시 **대상 정책/함수의 "최신 정의 마이그레이션"을 먼저 추적**해 현재 상태를 확인하고(단순히 계획서가 지목한 원본 파일만 보지 말 것), 이미 충족됐다면 문서화만 하고 넘어간다. 후보로 특히 `A-3`(storage 용량 제한), `A-7`(URL 검증), `A-10`(알림 중복) 등도 착수 전 현행 정의 재확인 권장.

### 2026-07-01 · A-10은 지목 벡터(EVENT_BOOKING_OPEN)가 이미 멱등키로 선충족, quota만 신규 추가
- **발견**: 보완-05가 지목한 정확한 시나리오(행사 `DRAFT↔BOOKING` 토글 루프 → EVENT_BOOKING_OPEN 대량 중복)는 이미 무력화 상태였다. `_notify_event_status`의 멱등키가 `event_open:{event_id}:{user_id}`로 (행사,수신자)당 고정이고 `notification_logs.idempotency_key`가 UNIQUE(0001)라, 아무리 토글해도 `ON CONFLICT DO NOTHING`으로 수신자당 1행만 적재된다. 감사는 멱등키가 전이마다 유니크할 것으로 가정한 듯하나 실제 코드는 고정 키였다.
- **조치**: 완료기준은 이미 충족이나 A-4처럼 0작업으로 두지 않았다. `_notify_booking_event`의 `booking:{booking_history.id}`(액션 행마다 새 키)와 향후 비멱등 타입은 여전히 무제한 적재 위험이 있어, 감사 권고의 "수신자별 quota"를 `_enqueue_notification`에 방어 심화로 추가(0081). 0038 로직은 전부 보존, 유량 가드 블록 1개만 추가.
- **일반화**: "멱등키 설계가 이미 dedup을 보장하는지"를 먼저 확인하라. 키가 고정이면 UNIQUE 제약이 상태전이 루프를 자동 차단한다. 키가 액션·시각마다 변하는 경로에만 별도 quota/이력 가드가 필요하다.

---

## E. 배포 전 미결 작업 (Pending Ops) — ⚠️ 코드는 완료·배포/인프라 세팅 미완

> 코드 변경은 완료됐으나 **배포 환경에서 시크릿·설정을 세팅해야** 정상 동작하는 항목. 미세팅 상태로 배포하면 서비스 회귀가 발생하므로, 배포 담당자가 반드시 먼저 처리한다.

### E-1. `[ ]` A-6 notification-dispatch 시크릿 세팅 (2026-07-01 등록)
- **왜**: A-6에서 `authorize()`를 fail-closed로 전환함. 이제 `NOTIF_DISPATCH_SECRET` 미설정 시 모든 디스패치 호출이 **503으로 거부**된다. 현재 프로덕션 시크릿은 **미설정/불확실** 상태.
- **위험**: 이 코드를 그대로 배포하면 알림 발송(Cron 디스패치)이 전부 멈춘다.
- **해야 할 일(배포 전)**:
  1. 강한 랜덤 값 하나 선정.
  2. 함수 env 설정: `supabase secrets set NOTIF_DISPATCH_SECRET=<값>`.
  3. Cron이 같은 값을 보내도록 vault 시크릿 세팅: `notif_dispatch_secret`=위와 **동일 값**, `notif_dispatch_url`=notification-dispatch 함수 URL.
  4. `0034_notification_infra.sql`의 Cron DO 블록 재실행(또는 `db push`)으로 `notification-dispatch-tick` 재등록.
- **검증**: 시크릿 없이 호출 시 503, 잘못된 시크릿 401, 올바른 시크릿(Cron)로 정상 발송(claimed/sent 로그 확인).

---

## D. 작업 완료 프로토콜 (매 항목 공통)

각 항목을 끝낼 때 에이전트는 반드시:
1. **구현** — 해당 항목만, 범위 밖 변경 금지.
2. **더블체크** — 완료 기준/테스트 케이스 실제 검증(빌드·타입·해당 RLS/함수 동작). 결과를 사실대로 보고(실패면 실패라고).
3. **메모리 기록** — `memory/`에 항목 결과 1파일 + `MEMORY.md` 1줄 포인터. 무엇을/왜/검증방법을 남김.
4. 이 문서의 해당 체크박스를 `[x]`로 갱신.
