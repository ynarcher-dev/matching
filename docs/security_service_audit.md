# 서비스 전체 보안 감사 메모

작성일: 2026-07-01  
범위: React/Vite 프론트, Supabase RLS/RPC, Edge Functions, Storage, 전체 라우트 및 관리자/스타트업/전문가/스태프 화면

## 1. 요약

현재 구조는 전반적으로 RLS와 `SECURITY DEFINER` RPC를 중심으로 권한을 통제하고 있으며, 운영자 Edge Function도 `service_role` 사용 전에 최고관리자 검증을 수행한다. 기본 방향은 좋다.

다만 운영 배포 기준으로는 다음 항목을 우선 조치해야 한다.

1. 참가자 로그인 방식이 `이름 + 휴대전화` 단일 지식 기반이라 사회공학/정보 추측에 약하다.
2. 참가자 커스텀 JWT가 `localStorage`에 저장되어 XSS 발생 시 계정 탈취로 이어진다.
3. Edge Function CORS 기본값이 `*`이고, 알림 디스패치는 시크릿 미설정 시 무인증으로 열린다.
4. URL 입력값 검증이 약해 `javascript:` 계열은 일부 방어되지만 `data:`, `file:`, 내부망 URL, 피싱 URL 등은 정책적으로 차단되지 않는다.
5. CSV/XLSX 다운로드가 사용자 입력을 그대로 셀에 넣어 Excel/Sheets formula injection 위험이 있다.
6. 같은 행사 참가자 간 개인정보/첨부파일 조회 범위가 넓다. 업무 의도라면 고지와 최소화가 필요하고, 아니라면 RLS 축소가 필요하다.
7. 운영자 임시 비밀번호/초대 링크가 응답으로 프론트에 노출된다. 화면 표시만이라도 운영 중 기록/스크린샷/브라우저 확장 유출 위험이 있다.
8. 의존성 감사에서 `exceljs -> uuid` moderate 취약점이 존재한다.

## 2. 공격 표면별 상세

### A. 인증/세션

#### A-1. 참가자 로그인: 이름+휴대전화만으로 JWT 발급

근거:
- `supabase/functions/participant-login/index.ts`가 `{ name, phone }`만 받아 JWT를 발급한다.
- `supabase/migrations/0035_participant_name_phone_login.sql`은 이름/전화가 정확히 1명과 매칭되면 OK 처리한다.
- rate limit은 `OTP_IP_SALT`가 있을 때만 IP 해시 기반으로 동작한다. 미설정 시 best-effort가 빠진다.

위험:
- 이름과 휴대전화는 행사 명단, 메신저, 명함, 검색, 내부 유출로 쉽게 얻을 수 있다.
- 성공 시 12시간 유효 JWT가 발급된다.
- NAT/공용망을 고려해 실패 20회/10분으로 넉넉하게 잡혀 있어, 유출된 명단 기반 자동 대입에는 약할 수 있다.

조치 지시:
- 운영 모드에서는 이름+전화 단독 로그인을 금지하고 OTP, 1회용 코드, 행사별 초대 토큰 중 하나를 추가한다.
- 최소 조치로 `OTP_IP_SALT`를 필수 시크릿으로 만들고, 미설정 시 `participant-login`이 500 또는 503으로 실패하게 한다.
- rate limit을 IP 단위뿐 아니라 `normalize(phone)`, `normalize(name)+phone`, user 후보 단위로도 적용한다.
- 로그인 성공/실패를 별도 보안 감사 로그로 남기고, 동일 전화/다수 이름 시도를 탐지한다.
- 참가자 JWT TTL을 행사 당일/운영 시간 기준으로 축소한다. 예: 2~4시간 또는 행사 종료 시각 중 빠른 값.

#### A-2. 참가자 JWT localStorage 저장

근거:
- `src/lib/participantSession.ts`에서 `yna.participant.token`을 `localStorage`에 저장한다.
- `src/lib/participantClient.ts`는 매 요청 `accessToken`으로 이 토큰을 사용한다.

위험:
- 현재 React 렌더링은 대체로 안전하지만, URL/파일/PDF/외부 스크립트/의존성 중 하나라도 XSS가 생기면 참가자 토큰이 즉시 탈취된다.
- 탈취 토큰은 RLS를 통과하므로 본인 데이터, 같은 행사 참가자 데이터, 첨부파일 signed URL 발급까지 가능하다.

조치 지시:
- 가능하면 Edge Function이 `HttpOnly; Secure; SameSite=Lax/Strict` 쿠키 세션을 설정하는 방식으로 전환한다.
- 전환 전 최소 조치로 memory-only 토큰 옵션을 추가하고, 새로고침 유지가 꼭 필요한 경우 `sessionStorage` + 짧은 TTL + idle timeout을 적용한다.
- CSP를 엄격히 적용해 XSS 가능성을 줄인다. `script-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`부터 시작한다.

#### A-3. 운영자 Supabase Auth 세션과 최고관리자 기능

근거:
- 운영자 로그인은 Supabase Auth이며 `users.auth_user_id`로 프로필을 조회한다.
- `operator-create/update/reset-password` Edge Function은 `authorizeSuperAdmin`을 통해 최고관리자를 확인한 뒤 `service_role`을 사용한다.

위험:
- 최고관리자 계정 탈취 시 운영자 생성/비밀번호 재설정/권한 부여까지 가능하다.
- 임시 비밀번호와 recovery link가 API 응답으로 반환되어 브라우저/확장/화면공유/로그에 노출될 수 있다.

조치 지시:
- 최고관리자 계정에 MFA를 강제한다.
- 운영자 생성/재설정 결과는 직접 비밀번호 반환보다 이메일 초대 링크 발송으로 전환한다.
- 임시 비밀번호 모드는 개발/비상 플래그에서만 허용하고, 운영에서는 비활성화한다.
- `operator-*` 함수 호출에 추가 re-auth 또는 최근 로그인 검증을 넣는다.

### B. Edge Functions / CORS / 비밀키

#### B-1. CORS 기본값이 전체 허용

근거:
- `supabase/functions/_shared/cors.ts`에서 `ALLOWED_ORIGIN`이 없으면 `Access-Control-Allow-Origin: *`.

위험:
- 브라우저에서 공격자 사이트가 함수 호출을 시도할 수 있다.
- Authorization 헤더가 필요한 함수는 토큰 탈취 없이는 막히지만, 공개 로그인/긴급 로그인/디스패치 같은 함수는 노출면이 커진다.

조치 지시:
- 운영 배포에서 `ALLOWED_ORIGIN`을 필수로 만들고 미설정 시 함수가 시작 또는 요청을 실패하게 한다.
- 여러 도메인이 필요하면 origin allow-list 매칭으로 응답 origin을 동적으로 제한한다.
- preflight에도 동일 allow-list를 적용한다.

#### B-2. notification-dispatch 시크릿 미설정 시 무인증 허용

근거:
- `supabase/functions/notification-dispatch/index.ts`의 `authorize()`는 `NOTIF_DISPATCH_SECRET`이 비어 있으면 `true`를 반환한다.

위험:
- 외부에서 반복 호출하여 알림 큐를 소모하거나 발송 비용/스팸 리스크를 만들 수 있다.
- 전역 발송이 켜진 상태라면 더 위험하다.

조치 지시:
- 운영/스테이징 모두 `NOTIF_DISPATCH_SECRET`을 필수화한다.
- 시크릿 미설정 시 503 반환.
- 호출 IP, user-agent, batch 결과를 별도 로그로 남기고 rate limit을 둔다.
- 가능하면 Supabase Scheduled Function/cron 전용 네트워크 경로로 제한한다.

### C. 권한/RLS

#### C-1. 같은 행사 참가자 간 프로필/파일 조회 범위가 넓음

근거:
- `users_select`는 `shares_event_with(id)`면 다른 참가자 프로필 조회를 허용한다.
- `proposals_read`는 `shares_event_with(owner_id)`면 소개서 PDF signed URL 발급을 허용한다.
- `avatars_read`는 인증 사용자 전체에게 허용된다.

위험:
- 같은 행사에 배정된 참가자가 다른 참가자의 이메일, 전화번호, 기업 정보, 소개서 파일에 접근할 수 있다.
- UX상 일부 정보는 필요하지만, 전체 `users` 컬럼을 읽을 수 있으면 최소권한 원칙에 어긋난다.

조치 지시:
- `users` 직접 SELECT 대신 역할별 view/RPC를 만든다.
  - 스타트업이 보는 전문가: 이름, 소속, 직책, 분야, 프로필 이미지 정도.
  - 전문가가 보는 스타트업: 배정된 슬롯의 기업 정보, 상담 요청, 소개서 등 필요한 범위.
  - 다른 스타트업 간 조회는 기본 차단.
- `proposals_read`는 `same event` 전체가 아니라 `해당 슬롯에 매칭된 전문가`, `본인`, `관리/스태프`로 축소한다.
- `avatars_read`는 공개 의도가 있더라도 서명 URL 발급 경로를 통해 필요한 사용자만 접근하도록 재검토한다.

#### C-2. event_operator_roles 조회가 본인/최고관리자 중심

근거:
- `0039_event_operator_roles.sql`의 SELECT RLS는 최고관리자 또는 본인 권한만 조회 가능하다.
- `0064_table_manager.sql` 주석에도 일반 MANAGER가 담당자 목록을 못 볼 수 있다고 되어 있다.

위험:
- 보안 취약점이라기보다 운영 혼선 위험이다. 권한 UI가 빈 목록을 보고 잘못된 판단을 할 수 있다.

조치 지시:
- 관리자 UI가 필요한 경우 `can_manage_event(event_id)` 범위에서 해당 행사 운영자 목록을 읽는 별도 RPC를 만든다.
- 프론트 권한 판정은 계속 참고용으로만 두고, 최종 권한은 DB/RPC에서 판단한다.

### D. 파일/스토리지

#### D-1. 파일 MIME 검증이 클라이언트 중심

근거:
- `src/lib/storage.ts`에서 PDF/image MIME과 크기를 클라이언트에서 검증한다.
- Storage RLS는 경로 소유권을 보지만 MIME/확장자/콘텐츠 검증은 하지 않는다.

위험:
- 공격자가 클라이언트 검증을 우회해 잘못된 content-type 또는 악성 PDF/이미지를 업로드할 수 있다.
- PDF는 브라우저 내장 뷰어/다운로드 경로에서 취약한 클라이언트와 만날 수 있다.

조치 지시:
- 업로드는 Edge Function 중계 또는 Storage trigger 검증으로 서버 측 MIME sniffing, 확장자, 크기, magic bytes를 확인한다.
- PDF는 `application/pdf` magic `%PDF-` 확인, 이미지도 magic byte 확인.
- 다운로드 응답은 가능하면 `Content-Disposition: attachment`로 강제하거나, 미리보기 도메인을 분리한다.
- 업로드 파일에 백신/멀웨어 스캔 파이프라인을 붙인다.

#### D-2. signed URL TTL 관리

근거:
- 파일 보기 signed URL은 보통 60~300초로 짧게 발급된다.
- 전문가 Split View PDF iframe은 signed URL을 사용한다.

위험:
- TTL 자체는 양호하지만, URL이 화면공유/로그/브라우저 히스토리/Referer로 유출될 수 있다.

조치 지시:
- signed URL을 외부 페이지로 이동시키지 말고 가능한 앱 내부 viewer에서만 사용한다.
- 외부 열기/다운로드 버튼에는 민감 파일 경고와 감사 로그를 남긴다.
- 파일 열람 이벤트를 `audit_logs` 또는 별도 `file_access_logs`에 기록한다.

### E. 입력값/XSS/URL

#### E-1. 사용자 URL 검증 부족

근거:
- `ReferenceUrlPanel`, `CompanyInfoPanel`, `SlotDetailModal`, `ParticipantDetailModal` 등에서 `normalizeUrl()`은 `http(s)`가 없으면 `https://`를 붙인다.
- DB RPC `add_my_company_link`, `set_my_company_homepage`는 길이만 제한하고 URL scheme/host 검증은 하지 않는다.

위험:
- `javascript:`는 `https://javascript:...`로 변환되어 직접 실행 가능성은 낮지만, `data:`, `file:`, `localhost`, 내부 IP, IDN homograph, 피싱 도메인 등은 정책적으로 걸러지지 않는다.
- 전문가/관리자가 클릭하는 링크이므로 피싱·악성 파일 유도에 취약하다.

조치 지시:
- 서버 RPC에서 URL을 표준 parser로 검증한다.
- 허용 scheme은 `https:` 우선, 필요 시 `http:`는 경고 또는 차단.
- `localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, link-local, IPv6 local을 차단한다.
- 표시 시 punycode/정규화된 hostname을 함께 보여주고, 외부 링크 이동 전 도메인을 명확히 표시한다.

#### E-2. CSP 부재와 외부 CDN 폰트

근거:
- `index.html`은 jsDelivr Pretendard CSS를 로드한다.
- CSP/meta 또는 서버 헤더 설정이 없다.

위험:
- 공급망 또는 CDN 변조 시 스타일 리소스가 공격 경로가 될 수 있다.
- CSP가 없으면 XSS가 발생했을 때 피해가 커진다.

조치 지시:
- 폰트를 자체 호스팅하거나 SRI를 적용한다.
- 배포 서버에 CSP, Referrer-Policy, X-Content-Type-Options, Permissions-Policy, frame-ancestors를 설정한다.
- 예: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co; frame-src 'self' https://*.supabase.co; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`.

### F. CSV/XLSX/보고서

#### F-1. Formula injection

근거:
- `src/lib/surveyReport.ts`의 `toCsv()`는 콤마/따옴표/개행만 escape한다.
- `src/lib/excel.ts`는 ExcelJS 셀에 사용자 입력 문자열을 그대로 넣는다.
- 상담 요청, 설문 주관식, 회사명, 홈페이지, 메모 등 사용자가 입력한 값이 CSV/XLSX로 내려간다.

위험:
- `=HYPERLINK(...)`, `=WEBSERVICE(...)`, `+cmd|...`, `@...` 등으로 시작하는 셀이 Excel/Sheets에서 수식으로 해석될 수 있다.
- 관리자 PC에서 파일을 열 때 외부 요청, 피싱, 정보 유출이 발생할 수 있다.

조치 지시:
- CSV/XLSX 내보내기 전 모든 문자열 셀에 formula guard를 적용한다.
- 값이 `=`, `+`, `-`, `@`, tab, CR로 시작하면 앞에 `'`를 붙인다.
- ExcelJS에서는 셀 타입을 명시적으로 string으로 지정하거나 guard된 문자열만 넣는다.
- 관련 테스트: 설문 주관식/상담 메모/회사명/URL이 `=1+1`, `@SUM(1,1)`일 때 파일 내용이 수식으로 저장되지 않아야 한다.

### G. 관리자/스태프 페이지

#### G-1. 일반 ADMIN의 전역 사용자 관리 가능성

근거:
- 라우트상 `/admin/startups`, `/admin/experts`, `/admin/settings`, `/admin/operators`는 `RequireSuperAdmin`으로 보호된다.
- 그러나 `users_insert_admin`, `users_update_admin`, `fields_write_admin` 등 일부 RLS는 `current_app_role() = 'ADMIN'`이면 허용한다.

위험:
- UI는 막혀도 API 직접 호출 시 일반 ADMIN이 전역 참가자/분야 데이터를 수정할 수 있다.
- 현재 “일반 ADMIN”이 행사 OWNER/MANAGER인지, 전역 관리자 역할인지 용어가 섞여 있다면 권한 상승처럼 보일 수 있다.

조치 지시:
- 전역 사용자 DB/설정/분야 관리는 DB RLS도 `is_super_admin()`으로 제한한다.
- 행사 범위 수정은 `can_manage_event(event_id)` RPC만 허용하고, `users` 직접 UPDATE는 최소화한다.
- “ADMIN”과 “super_admin”의 권한 표를 문서화하고 테스트로 고정한다.

#### G-2. 긴급 로그인 링크 발급 권한

근거:
- `issue_emergency_login_token`은 `current_app_role() = 'ADMIN'`이면 실행 가능하다.
- 라우트 UI는 최고관리자 페이지에 있지만 DB 권한은 일반 ADMIN까지 허용된다.

위험:
- 일반 ADMIN 토큰으로 직접 RPC 호출 시 참가자 긴급 로그인 링크 발급 가능.

조치 지시:
- 긴급 링크 발급을 `is_super_admin()` 또는 해당 행사 `OWNER/MANAGER` + 대상자가 그 행사 참가자인 경우로 제한한다.
- 링크 발급 화면/응답에 대상자, TTL, 사유, 발급자를 재확인하는 단계 추가.
- 링크 소비 후 대상자에게 알림 또는 관리자 감사 알림을 남긴다.

### H. 알림/개인정보

#### H-1. 알림 발송 목적/내용 검증

근거:
- notification-dispatch는 DB의 `notification_logs.content`, `destination`을 service_role으로 가져와 발송한다.

위험:
- 큐 삽입 권한 또는 RPC가 뚫리면 임의 내용 발송 가능.
- 개인정보가 알림 본문에 과도하게 포함될 수 있다.

조치 지시:
- 알림 생성 RPC에서 템플릿 기반 content 생성만 허용한다.
- 자유 본문 발송 기능은 최고관리자 + 별도 승인 로그 필요.
- destination 마스킹/검증, 발송 전 샘플링 감사 로그를 추가한다.

### I. 의존성/공급망

#### I-1. npm audit moderate

근거:
- `npm audit --omit=dev --json` 결과 `exceljs`가 `uuid <11.1.1` 취약점을 끌고 온다.

위험:
- 현재 사용 방식은 클라이언트 XLSX 생성이라 직접 악용 가능성은 제한적일 수 있으나, 파일 처리 라이브러리와 uuid 취약점은 유지보수 리스크다.

조치 지시:
- `exceljs` 최신 버전에서 취약 transitive dependency가 해결되는지 확인 후 업그레이드한다.
- audit CI를 추가하고 high/critical은 실패 처리, moderate는 승인 목록 또는 기한을 둔다.

## 3. 페이지별 확인 포인트

### 로그인/긴급 로그인
- 이름+전화 로그인에 2차 인증 추가.
- 실패 메시지는 계속 generic 유지.
- rate limit 미설정 시 실패하도록 변경.
- 긴급 링크는 짧은 TTL, 1회성, 발급/소비 감사 로그 유지. 권한은 재검토.

### 관리자 행사 목록/상세/AI 배치
- UI 권한은 참고용, 모든 변경은 RPC `can_manage_event` 확인 유지.
- 행사 상세에서 참가자 개인정보 표시 범위를 역할별로 나누기.
- 결과 다운로드 CSV/XLSX formula guard 적용.

### 관리자 참가자 DB
- 전역 참가자 생성/수정/삭제 RLS를 `is_super_admin()` 기준으로 축소.
- CSV 업로드는 행 수/파일 크기 제한, formula-like 값 저장 전 경고.
- 전화번호/이메일/회사명 등 개인정보 열람 로그 검토.

### 운영자/권한 관리
- operator-create/reset 임시 비밀번호 반환 금지 또는 운영 비활성화.
- 최고관리자 MFA 및 최근 재인증.
- 권한 변경은 현재 감사 로그가 있으므로 유지하되, 누가 누구에게 어떤 행사 권한을 줬는지 관리자 화면에서 검토 가능하게 한다.

### 스타트업 포털
- URL 등록 서버 검증.
- 소개서 업로드 서버 검증/스캔.
- 상담 요청 텍스트는 길이 제한은 있으나 보고서 export formula guard 필요.

### 전문가 대시보드
- 매칭된 스타트업 자료만 조회 가능하도록 RLS 재검토.
- PDF iframe 미리보기는 signed URL 노출/Referer 정책 확인.
- 외부 링크 클릭 전 도메인 표시.

### 스태프 사진/출석
- 사진 업로드 서버 검증/리사이즈는 좋으나 원본 EXIF 제거 여부 확인.
- 스태프 권한은 `can_staff_event`로 제한되어야 하며, 모든 사진 조회/삭제도 행사 범위 권한 테스트 필요.

## 4. 개발자에게 줄 우선순위 작업 목록

### P0
1. `NOTIF_DISPATCH_SECRET`, `ALLOWED_ORIGIN`, `OTP_IP_SALT`, `PARTICIPANT_JWT_SECRET` 필수화. 미설정 시 함수 실패.
2. notification-dispatch 무인증 허용 제거.
3. 참가자 로그인에 OTP/1회용 코드/초대 토큰 중 하나 추가하거나 최소한 phone/name/user/IP 복합 rate limit 적용.
4. 긴급 로그인 링크 발급 RPC 권한을 `is_super_admin()` 또는 행사 범위 권한으로 축소.
5. CSV/XLSX formula guard 적용.

### P1
1. 참가자 JWT 저장소를 localStorage에서 HttpOnly 쿠키 또는 memory/session 기반으로 전환.
2. URL 입력 서버 검증 및 내부망/비허용 scheme 차단.
3. 파일 업로드 서버 검증, magic byte 검사, 악성 파일 스캔.
4. `users`/`proposals` RLS를 “같은 행사 전체”에서 “업무상 필요한 관계”로 축소.
5. 보안 헤더와 CSP 배포 설정.

### P2
1. `exceljs`/transitive `uuid` 취약점 해소.
2. 파일 열람/다운로드 감사 로그 추가.
3. 운영자 임시 비밀번호 반환 플로우 제거.
4. 권한 회귀 테스트 확장: super admin, event owner, manager, staff, viewer, startup, expert별 API 직접 호출 테스트.

## 5. 추천 테스트 케이스

1. 일반 ADMIN이 `/rest/v1/users` 직접 UPDATE를 호출했을 때 전역 사용자 수정이 거부되는지.
2. 행사 A STAFF가 행사 B 출석/사진/슬롯 RPC를 호출하면 거부되는지.
3. 스타트업 A가 같은 행사 스타트업 B의 프로필/소개서 signed URL을 발급할 수 없는지.
4. 전문가가 매칭되지 않은 스타트업 소개서 signed URL을 발급할 수 없는지.
5. `NOTIF_DISPATCH_SECRET` 없이 dispatch 호출 시 503/401인지.
6. `OTP_IP_SALT` 없이 participant-login 호출 시 실패하는지.
7. URL `data:text/html,...`, `http://127.0.0.1`, `http://10.0.0.1`, `javascript:alert(1)`, IDN 도메인이 서버에서 차단/정규화되는지.
8. CSV/XLSX에서 `=HYPERLINK("https://evil.example")`, `+1+1`, `@SUM(1,1)`이 수식으로 실행되지 않는지.
9. 악성 content-type으로 PDF 버킷에 업로드 시 서버에서 거부되는지.
10. 참가자 세션 무효화 후 기존 JWT로 데이터 조회가 실패하는지.

## 6. 좋은 점

- RLS가 대부분의 핵심 테이블에 켜져 있다.
- 쓰기성 업무는 직접 테이블 UPDATE보다 RPC로 모으려는 방향이 잡혀 있다.
- `SECURITY DEFINER` 함수 다수가 `SET search_path`를 지정한다.
- 긴급 로그인 토큰은 평문 저장이 아니라 SHA-256 해시 저장, 1회 사용, TTL, 회수 구조를 갖고 있다.
- 운영자 service_role Edge Function은 자체적으로 최고관리자 검증을 선행한다.

이 기반은 살릴 만하다. 핵심은 운영 배포에서 “편의용 무료 로그인/전역 CORS/무인증 디스패치/넓은 co-participant 조회”를 잠그는 것이다.
