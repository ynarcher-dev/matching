# 작업 로그 — 2026-06-26 (무료 로그인 전환 · 현장 사진 업로드)

> Phase 7(종료 단계) 상용화 필요도 1·2·3순위 구현. 작업자: 에이전트 / 배포 상태: Local=Remote 0001~0036

---

## 1. 무료 로그인 전환 (1·2순위) — 마이그레이션 `0035`

참가자(EXPERT/STARTUP) 인증을 외부 발송 OTP에서 **`이름 + 휴대전화번호` 정확일치**로 전환해 외부 발송 의존성을 제거했다(가장 강한 상용화 블로커 해소).

### 확정 사항 (사용자 합의)
- 입력값 = 이름 + 휴대전화번호 (행사코드 미사용)
- 기존 OTP 인프라(`auth_otp_challenges`, `participant-otp-*`, 0009~0011) = **보존(비활성)**
- 이름 매칭 = 공백 정규화 + 대소문자 무시

### 백엔드
- `supabase/migrations/0035_participant_name_phone_login.sql`
  - `normalize_name(text)` — 모든 공백 제거 + 소문자 (IMMUTABLE). 전화는 기존 `normalize_phone` 재사용.
  - `match_participant_by_name_phone(name, phone)` — 활성 EXPERT/STARTUP 중 정규화 일치자가 **정확히 1명일 때만** user_id 반환(0명/2명+=NULL). SECURITY DEFINER, anon/auth EXECUTE 회수.
  - `login_participant_by_name_phone(name, phone, ip_hash)` — 매칭 + **IP 해시 기준 rate limit**(10분 창 실패 20회 초과 시 THROTTLED) + 시도 기록을 원자 처리. `{OK,user_id,role,session_version}` / `{THROTTLED,retry_after}` / `{INVALID}`. service_role 만 EXECUTE.
  - `participant_login_attempts` 테이블 (ip_hash·succeeded·created_at, RLS deny-all).
- `supabase/functions/participant-login/index.ts` — RPC 호출 → OK 면 프로필 조회 후 커스텀 JWT(HS256, `PARTICIPANT_JWT_SECRET`, 12h, claims=role/app_role/participant_id/session_version) 서명. INVALID=401 · THROTTLED=429 · 빈입력=400. 기존 verify Edge의 JWT 서명 로직 복제.

### 프론트엔드
- `schemas/authSchemas.ts` — `participantLoginSchema`{name, phone} + `normalizeName`/`normalizePhone`. 옛 OTP 스키마(`otpRequest/otpVerify/classifyIdentifier/normalizeOtp`) 제거.
- `types/auth.ts` — `OtpRequestResult` 제거.
- `stores/authStore.ts` — `requestOtp`/`verifyOtp` → 단일 `loginParticipant(name, phone)`.
- `components/auth/ParticipantLoginForm.tsx` — 2단계 OTP → 이름+전화 단일 폼(쿨다운/6자리 입력 제거).
- `views/LoginView.tsx` — 안내 문구 갱신.

### 검증
- lint · typecheck · build · test(**196**, auth.test 12) 통과.
- db push(0035) + Edge `participant-login` deploy.
- **라이브 풀 라운드트립 검증 완료**: 시드 전문가 `김민준`/`010-2001-1001` → 200 JWT 발급 → 발급 JWT로 PostgREST 본인행 200 / 변조 토큰 401 / `  김 민준  ` 공백정규화 매칭 200 / 전화불일치·미등록 401 / anon RPC 2종·`participant_login_attempts` 테이블 42501 차단.

---

## 2. 현장담당자 기업별 사진 업로드 (3순위) — 마이그레이션 `0036`

현장담당자(STAFF)/관리자(ADMIN)가 행사별 참가 기업(STARTUP)의 현장 사진을 모바일에서 촬영·일괄 업로드하고, 관리자가 등록 현황·누락 기업을 확인한다.

### 확정 사항 (기획 §8 미결정 해소)
- 대상 = 행사 참가 STARTUP 기업(`event_id` + `company_user_id`), 행사별 누적
- 업로드 범위 = 행사의 모든 참가 기업(담당 구역 제한 없음)
- 삭제 = soft delete(`deleted_at`) + 스토리지 객체 제거
- 엑셀 내보내기 포함 = 보류

### 백엔드
- `supabase/migrations/0036_company_photos.sql`
  - `event-photos` 비공개 버킷. 경로 `event-photos/{event_id}/{company_user_id}/{uuid}.{ext}` (0007 `_storage_owner_id` 재사용).
  - `company_photos` 테이블(event_id·company_user_id·uploaded_by·storage_path·메타·deleted_at) + 부분 인덱스.
  - **테이블 RLS**: select=관리자/스태프·기업본인 / insert=관리자/스태프 + uploaded_by 본인 + 대상이 해당 행사 STARTUP 참가자 EXISTS / update(soft delete)=관리자/스태프. (물리 DELETE 정책 없음.)
  - **storage RLS**(event-photos): read=관리자/스태프·기업본인 / write·update·delete=관리자/스태프.
  - 테이블은 auto-expose + RLS 게이트(별도 GRANT 불필요 — revoke-by-default 는 함수 EXECUTE 에만 해당). **신규 Edge 불필요**.

### 프론트엔드 (전부 operator `supabase` 클라이언트)
- `types/companyPhoto.ts`, `lib/companyPhoto.ts` — 검증·경로빌더·캔버스 리사이즈(1600px/JPEG 0.82)·Signed URL(batch)·현황 집계(`buildCompanyStatuses`/`summarizePhotoStatus`/`filterCompanyStatuses`) 순수함수.
- `hooks/useCompanyPhotos.ts` — 조회 / 업로드(리사이즈→업로드→INSERT, 부분 성공) / soft delete(+객체 제거) / Signed URL.
- `views/staff/StaffPhotosView.tsx` + `components/staff/{CompanyPhotoList, CompanyPhotoUploadPanel}` — 행사 선택 → 기업 검색/선택 → 카메라(`accept=image/* capture=environment`)/앨범 → 미리보기 → 일괄 업로드 → 삭제.
- `components/admin/PhotoStatusPanel.tsx` — 행사 상세 `사진 현황` 탭(요약 4지표·기업별 개수/마지막 업로드·미등록 강조·검수 펼침).
- STAFF 네비 `현장 사진` + `/staff/photos` 라우트. EventDetailView 탭 추가.

### 검증
- lint · typecheck · build · test(**205**, companyPhoto.test 9) 통과.
- db push(0036).
- anon 스모크: `company_photos` SELECT 200 `[]`(행 노출 0) · INSERT 42501 차단 · `event-photos` 버킷 RLS 게이트 확인.
- ⚠ **라이브 UI 라운드트립 미검증**(STAFF 운영진 로그인 + 실제 카메라 업로드).

---

## 3. 수동 테스트 환경 세팅 (카메라 테스트용)

> 영구 기능이 아니라 테스트 스캐폴딩. 마무리 시 정리 예정.

- **테스트 STAFF 계정 생성**: `staff-test@yna.dev` / `StaffTest!2026` (Auth Admin API로 auth 계정 + `public.users` STAFF 행 연결, 로그인 검증 완료). dev 시드(0016)는 실 인증 계정을 만들지 않으므로 수동 생성.
- **HTTPS dev 서버**(폰 카메라 보안 컨텍스트용): `@vitejs/plugin-basic-ssl@^1.2.0`(dev 의존성) 추가 + `vite.config.ts`에 `HTTPS=1`일 때만 켜지는 opt-in 한 줄. 평소 `npm run dev`/build/test 무영향.
  - 실행: `HTTPS=1 npm run dev -- --host 192.168.0.18 --port 5173` → `https://192.168.0.18:5173/`
  - 폰: 같은 Wi-Fi 접속 → 자체 서명 인증서 경고 수락 → 운영진 탭 로그인 → 현장 사진.
- 테스트용 행사(STARTUP 참가): IR 매칭데이(51) / 상담 진행데이(16) / 바이오 파트너링데이(8).

### 마무리 시 정리 항목(요청 대기)
1. dev 서버 종료
2. 테스트 STAFF 계정(`staff-test@yna.dev`) 삭제
3. vite 설정 원복(`@vitejs/plugin-basic-ssl` 제거 + config 라인 삭제)

---

## 문서 동기화 / 진척도

- `development_status.md` — Phase 7 항목 ①②③ 완료 표기.
- `free_login_transition.md`, `staff_company_photo_upload.md` — 상태 헤더 "구현 완료".
- `page_auth_layout.md §1`, `security_transactions.md §1` — 이름+전화번호 전환 노트 추가.
- ⚠ 후속: `user_guide.md` 동기화 미반영.

## 남은 Phase 7 태스크
- **④ 행사별 알림 채널 정책**(발송안함[기본]/알림톡/SMS/알림톡+SMS fallback) — 자체 개발 토대. 참조 `event_notification_api_plan.md`.
- **⑤ 실공급사(Solapi) 어댑터** — 외부 키 없으면 완료·검증 불가, 맨 뒤.
