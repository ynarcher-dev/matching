# 개발 컨벤션 및 yna-db 참고 정책 (Development Conventions)

본 문서는 `yna-matching` 구현 시 적용하는 기술 스택 확정 사항과, 형제 프로젝트 [`c:\dev\yna-db`](../../yna-db) (YNA 데이터베이스 PMS)에서 **무엇을 참고/재사용하고 무엇을 의도적으로 갈라내는지**를 고정 기준으로 명문화합니다. 매 작업마다 yna-db를 재탐색하지 않고 이 문서를 단일 기준으로 삼습니다.

> [!IMPORTANT]
> 스펙 충돌 시 **항상 yna-matching의 `docs/` 명세가 우선**합니다. yna-db는 "검증된 인프라 패턴 레퍼런스"일 뿐, 디자인·UI 철학·인증 모델은 yna-matching docs를 따릅니다.

---

## 1. 확정 기술 스택

| 항목 | 결정 | 근거 |
| :--- | :--- | :--- |
| 언어 | **TypeScript** (`.tsx` / `.ts`) | yna-db 전체 TS. 타입 안정성·DB 스키마 타입화. (docs의 `.jsx` 표기는 예시로 간주) |
| 빌드 | **Vite (React 18 SPA)** | overview.md 4장 |
| 스타일 | **Tailwind CSS v4 (순수 Tailwind)** | docs 명시. CSS `@import "tailwindcss"` + `@tailwindcss/vite` 플러그인 방식 |
| UI 라이브러리 | **없음 (AntD 미사용)** | docs: 인라인 스타일 전면 금지·Tailwind만. 컴포넌트 직접 제작 |
| 백엔드 | **Supabase (PostgreSQL 15+)** | db_schema.md |
| 데이터 패칭 | **@tanstack/react-query** | yna-db 패턴 채택 |
| 전역 상태 | **zustand** (`authStore`, `uiStore`) | yna-db 패턴 채택 |
| 폼/검증 | **react-hook-form + zod** | yna-db 패턴 채택 |
| 날짜 | **dayjs** (행사 timezone 변환) | yna-db 패턴 채택 |
| 라우팅 | **react-router-dom v6** | yna-db 패턴 채택 |
| 파일 저장 | **Supabase Storage + Signed URL** | security_transactions.md 2장 (yna-db의 AWS S3 방식과 다름) |

### 절대 규칙 (overview.md / 각 페이지 명세)
- 모든 소스 파일 **500줄 이하**. 초과 시 컴포넌트/훅 분리.
- **인라인 스타일(`style={{...}}`) 전면 금지** → Tailwind 클래스만.
- 브랜드 컬러: Primary `#E22213`(레드) / Neutral `#515151`(다크그레이).
- 기본 경계선은 **1px 중립 회색**으로 두고, 포커스·선택·오류 상태에만 브랜드/상태 색상을 사용합니다. 카드에는 12~16px 모서리와 제한적인 약한 그림자를 허용합니다.
- 모바일 퍼스트(360~768px), 좌측 240px 고정 사이드바(데스크톱) / 햄버거 슬라이드인 드로어(모바일).

---

## 2. yna-db에서 참고(재사용)하는 것

| 항목 | yna-db 위치 | 적용 방식 |
| :--- | :--- | :--- |
| Supabase 클라이언트 | `src/lib/supabaseClient.ts` | VITE_ 환경변수 격리 패턴 거의 그대로 |
| Vite 설정 | `vite.config.ts` | `@`→`src` alias, vitest(jsdom) 설정 복제 |
| tsconfig | `tsconfig.json` | strict + `@/*` paths 복제 |
| eslint/prettier/postcss | 루트 dotfiles | 골격 복제(단 Tailwind v4에 맞게 postcss 조정) |
| 폴더 구조 | `src/{components,hooks,lib,schemas,stores,types,routes,views}` | 동일 컨벤션 채택 |
| 마이그레이션 번호 규칙 | `supabase/migrations/0001_schema.sql → 0002_rls.sql → 기능별 RPC` | 순차 번호 규칙 채택 |
| 목록 공통 규약 | `17_conventions.md` 2장 / `useListQuery` | 검색 debounce 300ms·필터/정렬/페이지 URL 직렬화·서버 페이지네이션·`deleted_at IS NULL` |
| 라우트 가드 | `RequireAuth` → `RequireRole` 중첩 | 패턴 채택(역할: ADMIN/STAFF/EXPERT/STARTUP) |
| enum 라벨 매핑 | `src/lib/labels.ts` | DB 영문 enum → 한국어 라벨 단일 매핑 |
| 폼 검증 규약 | `17_conventions.md` 3장 | zod 스키마를 DB CHECK 제약과 정합 |

---

## 3. yna-db와 의도적으로 갈라내는 것

| 항목 | yna-db | yna-matching | 사유 |
| :--- | :--- | :--- | :--- |
| UI 라이브러리 | AntD 전면 사용 | **AntD 제외, 순수 Tailwind** | docs 인라인 금지·Tailwind only 철학 |
| Tailwind | v3.4 + postcss + config | **v4 (CSS import 방식)** | docs 명시 |
| 인증 | Supabase Auth 단일 | **등록 연락처 OTP 무비번 인증** (EXPERT/STARTUP) + Supabase Auth(ADMIN/STAFF) | 대량 참가자에게 동일 접속 안내를 제공하기 위한 신규 구현 |
| 파일 저장 | AWS S3 + CloudFront + Edge Function presigned | **Supabase Storage Signed URL** | docs 명시 |
| 도메인 | 투자/AC 통합 PMS | 행사 비즈니스 매칭 운영 | 완전히 다른 도메인 |

---

## 4. 폴더 구조 (채택)

```
src/
  components/   # 역할/도메인별 UI 컴포넌트 (admin/, auth/, common/, expert/, startup/, staff/)
  hooks/        # 데이터 훅(useListQuery, useEventDashboard 등)
  lib/          # supabaseClient, labels, formatters, navigation
  schemas/      # zod 검증 스키마
  stores/       # zustand (authStore, uiStore)
  types/        # 도메인 타입, DB 타입
  routes/       # AppRoutes, 가드
  views/        # 페이지 단위 (라우트 진입점)
supabase/
  migrations/   # 0001_schema.sql, 0002_rls.sql, 0003_rpc_*.sql ...
  functions/    # Edge Functions (인증 RPC가 부족할 때, QR 서명 등)
```

---

## 5. 인증·세션 모델 (참가자 vs 운영진)

yna-matching은 두 인증 경로가 공존하며 RLS 설계의 핵심 전제다.

| 구분 | ADMIN / STAFF | EXPERT / STARTUP |
| :--- | :--- | :--- |
| 인증 수단 | Supabase Auth (이메일·비밀번호) | **등록 이메일/휴대전화 OTP** (무비번) |
| 세션 토큰 | Supabase 표준 JWT (`auth.uid()` 유효) | **Edge Function이 발급한 커스텀 JWT** |
| `public.users` 매핑 | `users.auth_user_id = auth.uid()` | JWT 커스텀 클레임 `participant_id` |

### 5.1 커스텀 JWT 클레임 (참가자)
Edge Function은 OTP 검증 성공 후 참가자 커스텀 JWT를 서명해 발급한다.
- `role`: `authenticated` (PostgREST 통과용 표준 클레임)
- `app_role`: `EXPERT` | `STARTUP`
- `participant_id`: `public.users.id`
- `session_version`: 발급 시점의 `users.session_version` (관리자 세션 무효화 시 불일치 → 무효화)

### 5.2 RLS 헬퍼 (0002_auth_helpers.sql)
- `current_app_user_id()`: 운영진=auth_user_id 매핑, 참가자=`participant_id` 클레임 + `session_version` 일치 검증 후 `users.id` 반환.
- `current_app_role()` / `is_super_admin()`: 위 id 기준 역할/최고관리자 판정.
- 모든 RLS·RPC 권한 판정은 `auth.uid()` 직접 사용 대신 이 헬퍼를 경유한다.

### 5.3 참가자 OTP 처리
- 운영본부는 모든 참가자에게 동일한 로그인 URL과 사용 안내를 발송합니다. 사용자별 장기 비밀 코드는 안내하지 않습니다.
- 참가자는 등록된 이메일 또는 휴대전화 번호를 입력하고, 해당 채널로 전달된 6자리 OTP를 검증합니다.
- OTP 원문은 저장하거나 로그에 남기지 않고 해시와 만료 시각만 저장합니다. 기본 유효시간은 5분입니다.
- 재요청은 60초 간격으로 제한하고, 챌린지당 검증 실패는 최대 5회로 제한합니다.
- 계정 존재 여부를 추측하지 못하도록 OTP 요청 응답은 성공 여부와 무관하게 동일한 일반 메시지를 반환합니다.
- 행사코드를 도입하더라도 행사 선택·접근 경로 구분 용도로만 사용하며 단독 인증 수단으로 사용하지 않습니다.
- 현장 예외 상황에서는 관리자가 본인 확인 후 짧은 만료시간의 1회용 로그인 링크를 발급할 수 있습니다.

> [!NOTE]
> 커스텀 JWT 발급은 **Edge Function(Deno)** 에서 수행합니다. DB는 OTP 요청·검증과 세션 버전 확인을 위한 SECURITY DEFINER RPC를 제공하고, Edge Function이 검증 완료 후 JWT를 서명합니다.

---

## 6. 변경 이력
- 2026-06-25: 최초 작성. 스택 확정(TS / Tailwind v4 / 순수 Tailwind, AntD 제외), yna-db 참고/분기 정책 명문화.
- 2026-06-25: 인증·세션 모델(운영진 Supabase Auth / 참가자 커스텀 JWT) 및 Access Code 처리 정책 추가.
- 2026-06-25: 참가자 인증 목표 모델을 사용자별 Access Code에서 등록 이메일/휴대전화 OTP로 변경. UI 경계선 규칙을 굵은 전역 테두리에서 자연스러운 시각 위계로 변경.
