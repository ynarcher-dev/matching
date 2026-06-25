# Supabase 백엔드 (yna-matching)

행사 비즈니스 매칭 시스템의 DB 스키마·RLS·RPC 마이그레이션입니다.
상세 설계 근거는 [`docs/db_schema.md`](../docs/db_schema.md), [`docs/security_transactions.md`](../docs/security_transactions.md), [`docs/dev_conventions.md`](../docs/dev_conventions.md)를 따릅니다.

## 마이그레이션 구성 (적용 순서)

| 파일 | 내용 |
| :--- | :--- |
| `0001_schema.sql` | 코어 15개 테이블 DDL + 정합성/성능 인덱스 |
| `0002_auth_helpers.sql` | 인증·역할 헬퍼 + (Deprecated) Access Code 해시/발급·참가자 로그인 빌딩블록 |
| `0003_rls.sql` | 전체 테이블 RLS + 역할별 정책 + 민감 컬럼(access_code_hash) 차단 |
| `0004_booking_rpc.sql` | 예약 신청/변경/취소/관리자 강제배정 + 중복·테이블 충돌·최대횟수 검증 |
| `0005_session_rpc.sql` | 상담 시작/노쇼/세션 취소/상담일지 임시저장·제출/출석 체크 |
| `0006_status_cron.sql` | 행사 상태 1분 Cron 자동 전환 + 최고관리자 수동 Override |
| `0007_storage.sql` | `proposals`·`avatars` 비공개 버킷 + Signed URL 접근 정책 |
| `0008_self_service_auth.sql` | (Deprecated) Access Code 셀프 재발송 RPC(`reissue_access_code_self`) |
| `0009_otp_auth.sql` | **참가자 OTP 전환**: `auth_otp_challenges`·`emergency_login_tokens` 테이블 + 요청/검증 RPC(`request_participant_otp`/`verify_participant_otp`) + 헬퍼. 구 Access Code RPC EXECUTE 회수 |
| `0010_otp_grants.sql` | OTP 진입점 RPC 의 `service_role` EXECUTE 명시 부여 (2026-05-30 revoke-by-default 클라우드 기본값 대응) |
| `0011_fix_match_identifier.sql` | `match_participant_by_identifier` 의 `min(uuid)`(PG 미존재) → `array_agg` 모호성 판별로 수정 |
| `seed.sql` | 기준 분야 마스터 데이터(선택) |

> **2026-06-25 인증 전환**: 참가자(EXPERT/STARTUP) 인증을 사용자별 8자리 Access Code 에서
> 등록 이메일/휴대전화 6자리 OTP 로 변경. `0002`/`0008` 의 Access Code 빌딩블록은 전환기 보존하되
> 클라이언트 EXECUTE 를 회수했고, `users.access_code_hash`/`access_code_issued_at` 컬럼은 데이터 정리
> 전까지 Deprecated 상태로 유지합니다.

## Edge Functions (Phase 3 인증 — OTP)

| 함수 | 역할 |
| :--- | :--- |
| `participant-otp-request` | 등록 연락처 매칭·레이트리밋·OTP 발급(`request_participant_otp` RPC) 후 Mock 어댑터로 발송. 계정 열거 방지 generic 응답 |
| `participant-otp-verify` | 6자리 OTP 검증(`verify_participant_otp` RPC, 원자적 1회 사용) 후 참가자 커스텀 JWT 발급 |

두 함수는 미인증 호출이라 `config.toml` 에서 `verify_jwt = false`. 배포·시크릿:

```bash
# 커스텀 JWT 서명용 시크릿(= 프로젝트 JWT(HS256) 시크릿). SUPABASE_ 접두사는 예약어라 사용 불가.
supabase secrets set PARTICIPANT_JWT_SECRET=<project-jwt-secret>
# (선택) 요청 IP 비식별 해시용 솔트 / 로컬 디버깅용 OTP 콘솔 출력
# supabase secrets set OTP_IP_SALT=<random-salt>
supabase functions deploy participant-otp-request participant-otp-verify
```

> SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY 는 런타임 자동 주입. 발송은 현재 `_shared/notifier.ts` 의
> `MockNotifier`(마스킹 로그, OTP 원문 비저장). 실 공급사(Solapi 등) 어댑터·`notification_logs` 감사 연동은 Phase 7.
> OTP 정책: 5분 만료 / 60초 재요청 / 챌린지당 검증 실패 최대 5회 / 새 발급 시 이전 미사용 OTP 무효화.

## 적용 방법

```bash
# 프로젝트 연결 (project-ref 는 Supabase 대시보드에서 확인)
supabase link --project-ref <your-project-ref>

# 마이그레이션 푸시
supabase db push

# 시드 적용 (선택)
psql "$DATABASE_URL" -f supabase/seed.sql
```

> 로컬 검증은 Docker 가 필요합니다(`supabase start` → `supabase db reset`).

## 인증 모델 (요약)

- **ADMIN / STAFF**: Supabase Auth(이메일·비밀번호). `users.auth_user_id = auth.uid()` 매핑.
- **EXPERT / STARTUP**: 등록 이메일/휴대전화 6자리 OTP. `participant-otp-request` 가 발송하고,
  `participant-otp-verify` 가 `public.verify_participant_otp()` 검증 성공 후 커스텀 JWT
  (`participant_id`·`session_version`·`app_role` 클레임)를 발급.
  → Edge Function 본체는 `functions/participant-otp-request/`·`functions/participant-otp-verify/` 에 구현됨.

## 변경 작업은 RPC 전용

예약·변경·취소·강제배정·상담시작·노쇼·세션취소·일지제출·출석·상태전환은 클라이언트 직접 UPDATE 가 아니라
모두 `SECURITY DEFINER` RPC 단일 트랜잭션으로만 처리합니다(테이블에 클라이언트 쓰기 정책 없음).
