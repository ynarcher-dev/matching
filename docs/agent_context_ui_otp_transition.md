# 다른 에이전트용 작업 컨텍스트: UI 위계 개선 및 참가자 OTP 전환

## 1. 작업 목표

현재 구현된 로그인·공통 UI를 아래 목표 명세에 맞게 재작업합니다.

1. 모든 컴포넌트에 반복된 `2px #515151` 테두리를 제거하고 자연스러운 시각 위계를 적용합니다.
2. 전문가·스타트업의 사용자별 8자리 Access Code 로그인을 폐기하고, `공통 로그인 안내 + 등록 이메일/휴대전화 6자리 OTP` 흐름으로 전환합니다.
3. 관리자·현장 스태프의 Supabase Auth 로그인은 유지합니다.
4. 기존 역할별 커스텀 JWT, RLS 헬퍼, 라우트 가드, 로그인 후 리다이렉션 구조는 가능한 범위에서 재사용합니다.

이 문서는 작업 지시용 요약입니다. 세부 충돌이 있으면 아래 필독 문서의 최신 내용이 우선합니다.

## 2. 필독 문서와 읽는 순서

1. [개발 개요](./overview.md)
   - 전체 사용자 역할과 새 디자인 원칙 확인.
2. [개발 컨벤션](./dev_conventions.md)
   - Tailwind v4, 파일 크기, 인증·JWT·RLS 구현 원칙 확인.
3. [인증 및 공통 레이아웃 명세](./page_auth_layout.md)
   - OTP 화면 흐름, 문구, 만료·재요청·세션 정책, UI 컴포넌트 표현 확인.
4. [인증·권한·트랜잭션 정책](./security_transactions.md)
   - 계정 열거 방지, OTP 원문 비저장, RPC 전용 처리와 권한 정책 확인.
5. [DB 스키마 명세](./db_schema.md)
   - `auth_otp_challenges`, `emergency_login_tokens`, Deprecated Access Code 컬럼과 정합성 규칙 확인.
6. [관리자 참가자 관리 명세](./page_admin_user_management.md)
   - CSV 등록 후 일괄 안내, 인증 채널 상태, 세션 무효화, 현장 예외 처리 확인.
7. [개발 현황](./development_status.md)
   - 무엇이 기존 구현이고 무엇이 새 기획에 따른 미구현인지 확인.

현재 배포된 기존 구현을 파악할 때만 `supabase/README.md`와 기존 마이그레이션·Edge Function을 읽습니다. 해당 README는 현행 코드 설명이며 새 목표 명세가 아닙니다.

## 3. 확정된 제품 결정

### UI

- 일반 카드: 흰색 배경, 12~16px 모서리, 1px 중립 회색 경계선, 필요한 경우에만 약한 그림자.
- 입력창: 기본 1px 중립 경계선, 포커스 시 브랜드 레드.
- 역할 탭: 굵은 칸막이 대신 세그먼트 컨트롤.
- Primary 버튼: 브랜드 레드 면, 진회색 외곽선 없음.
- 오류/안내: 연한 상태 배경과 아이콘 또는 왼쪽 강조선.
- `#515151`은 주로 텍스트와 사이드바에 사용하며 모든 경계선에 반복 적용하지 않음.

### 참가자 인증

- 전체 참가자에게 같은 로그인 URL과 절차를 한 번에 안내.
- 등록 이메일 또는 휴대전화 입력 후 6자리 OTP 요청.
- OTP 기본 만료 5분, 재요청 간격 60초, 챌린지당 실패 최대 5회.
- OTP 원문과 인증 링크 원문은 DB·애플리케이션 로그에 저장하지 않음.
- OTP 요청은 계정 존재 여부와 무관하게 동일한 일반 응답 반환.
- 새 OTP 발급 시 이전 미사용 OTP 무효화.
- 검증 성공과 OTP 사용 처리는 원자적 트랜잭션으로 수행.
- 참가자 세션은 기본 12시간 또는 행사 종료 시각 중 빠른 시점에 만료.
- 공통 행사코드는 선택적으로 사용할 수 있지만 단독 인증 수단이 아님.
- 현장 장애 시 관리자가 본인 확인 후 짧게 만료되는 1회용 로그인 링크를 발급할 수 있음.

## 4. 현재 코드에서 예상되는 변경 지점

- `src/views/LoginView.tsx`
- `src/components/auth/RoleTabs.tsx`
- `src/components/auth/ParticipantLoginForm.tsx`
- `src/components/auth/ResendCodePanel.tsx`
- `src/components/auth/OperatorLoginForm.tsx`
- `src/components/common/TextField.tsx`
- `src/components/common/Button.tsx`
- `src/components/common/Header.tsx`
- `src/components/common/Sidebar.tsx`
- `src/index.css`
- `src/schemas/authSchemas.ts`
- `src/stores/authStore.ts`
- `src/types/auth.ts`
- `supabase/migrations/0002_auth_helpers.sql`
- `supabase/migrations/0008_self_service_auth.sql`
- `supabase/functions/participant-login/`
- `supabase/functions/participant-resend-code/`

기존 마이그레이션을 수정해 배포 이력을 깨지 말고, 새 순번의 전환 마이그레이션을 추가하는 방식을 우선합니다.

## 5. 구현 순서 제안

1. 새 UI 토큰과 공통 `Card`, `TextField`, `Button`, `Alert`, 탭 스타일을 먼저 정리합니다.
2. OTP 챌린지·예외 로그인 토큰용 신규 마이그레이션과 RLS/권한을 작성합니다.
3. OTP 요청·검증 서버 함수를 구현하고 계정 열거 방지와 레이트리밋을 검증합니다.
4. 참가자 로그인 화면을 2단계 OTP 흐름으로 교체합니다.
5. OTP 성공 결과를 기존 참가자 커스텀 JWT와 역할별 리다이렉션에 연결합니다.
6. 관리자 참가자 관리 기능에서 인증 채널 상태와 세션 무효화 경로를 연결합니다.
7. 기존 Access Code 기능을 참조하는 UI·테스트·문서를 정리하되, 운영 데이터 전환 전략이 확인되기 전에는 DB 컬럼을 즉시 삭제하지 않습니다.

## 6. 완료 조건

- 참가자별 코드를 개별 안내하지 않고 동일한 접속 안내만으로 로그인할 수 있음.
- 등록되지 않은 연락처와 등록된 연락처에 대한 OTP 요청 응답으로 계정 존재 여부를 구분할 수 없음.
- OTP 만료·재요청·실패 횟수·일회 사용·동시 검증이 테스트됨.
- 기존 관리자/스태프 로그인과 역할별 라우트 가드가 회귀하지 않음.
- 로그인 화면과 공통 컴포넌트에서 불필요한 `border-2 border-neutral-base`가 제거됨.
- 모바일 360px부터 데스크톱까지 레이아웃이 깨지지 않음.
- `lint`, `typecheck`, `build`, 관련 테스트가 모두 통과함.
- 구현 후 [개발 현황](./development_status.md)을 실제 결과에 맞게 갱신함.

## 7. 주의 사항

- 문서 변경은 완료됐지만 구현 코드는 아직 기존 Access Code 방식입니다.
- `supabase/README.md`는 현재 배포 상태 설명이므로 새 구현 완료 전까지 무리하게 목표 상태로 바꾸지 않습니다.
- 이메일과 휴대전화가 모두 중복되거나 여러 활성 사용자와 매칭되는 경우의 정책을 서버에서 명시적으로 처리해야 합니다. 기본 원칙은 모호한 매칭으로 로그인시키지 않는 것입니다.
- 발송 공급자 선정이나 실제 메시지 템플릿이 확정되지 않았다면 어댑터 인터페이스와 Mock 구현을 먼저 두고, 비밀키를 저장소에 커밋하지 않습니다.
