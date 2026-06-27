# [기능 명세] 운영자 계정 관리 및 행사별 관리자 권한

본 문서는 현재 전역 `ADMIN` 권한으로 운영되는 관리자 기능을 **운영자 계정 관리**와 **행사별 권한 부여** 구조로 확장하기 위한 개발 명세입니다. 여기서 "프로젝트"는 현 스키마의 `events`(행사) 단위를 의미합니다.

---

## 1. 배경과 목표

현재 구현은 `users.role = 'ADMIN' | 'STAFF'` 인 운영진이 Supabase Auth로 로그인하고, RLS/RPC 대부분이 `current_app_role() = 'ADMIN'` 또는 `is_admin_or_staff()`를 기준으로 전역 접근을 허용합니다. `is_super_admin` 컬럼은 상태 강제 변경처럼 일부 최고관리자 기능에 사용되지만, 관리자 계정 생성이나 행사별 운영 범위 제한에는 아직 연결되어 있지 않습니다.

### 목표
- 최고관리자가 앱 안에서 운영자(`ADMIN`, `STAFF`) 계정을 생성, 비활성화, 초대/비밀번호 초기화할 수 있습니다.
- 최고관리자가 특정 행사에 운영자를 배정하고, 권한 수준을 지정할 수 있습니다.
- 일반 관리자는 자신에게 배정된 행사만 조회/수정할 수 있습니다.
- 현장 스태프는 배정된 행사에서만 현장 업무(사진 업로드, 출석 처리 등)를 수행할 수 있습니다.
- 모든 권한 부여/회수/계정 상태 변경은 감사 로그에 남깁니다.

### 비목표
- 조직/테넌트 단위 멀티테넌시 도입은 이번 범위에서 제외합니다.
- 참가자(`EXPERT`, `STARTUP`) 권한 모델은 유지합니다.
- Supabase Auth 사용자 생성은 브라우저에서 직접 처리하지 않고 Edge Function(service role)으로만 처리합니다.

---

## 2. 권한 모델

### 2.1 운영자 종류

| 구분 | 조건 | 접근 범위 |
| :--- | :--- | :--- |
| 최고관리자 | `users.role = 'ADMIN'` and `is_super_admin = true` | 전체 행사, 운영자 계정, 권한 배정, 전역 설정 |
| 행사 관리자 | `users.role = 'ADMIN'` and 행사 권한 보유 | 배정된 행사 운영 데이터 |
| 행사 스태프 | `users.role = 'STAFF'` and 행사 권한 보유 | 배정된 행사 현장 기능 |
| 참가자 | `EXPERT`, `STARTUP` | 기존 참가자 권한 유지 |

### 2.2 행사별 권한 등급

신규 테이블 `event_operator_roles`를 둡니다.

| 컬럼 | 설명 |
| :--- | :--- |
| `id` | UUID PK |
| `event_id` | 행사 FK |
| `user_id` | 운영자 FK (`ADMIN` 또는 `STAFF`) |
| `permission` | `OWNER`, `MANAGER`, `STAFF`, `VIEWER` |
| `created_by` | 부여자 |
| `created_at` | 부여 시각 |
| `revoked_at` | 회수 시각(soft revoke) |

권장 제약:
- 활성 권한은 `(event_id, user_id)` 유니크.
- `permission = 'STAFF'`는 `users.role = 'STAFF'` 또는 `ADMIN` 모두 허용하되, UI에서는 STAFF 계정에 우선 사용합니다.
- `OWNER`는 행사 삭제/취소/권한 재배정까지 가능한 행사 단위 책임자입니다.
- `MANAGER`는 행사 설정/참가자 배정/배치/리포트 다운로드가 가능합니다.
- `STAFF`는 현장 사진/출석 처리 등 현장 기능만 가능합니다.
- `VIEWER`는 조회 및 리포트 확인만 가능합니다.

---

## 3. DB/RLS 설계

### 3.1 신규 헬퍼

다음 SECURITY DEFINER 헬퍼를 추가합니다.

- `is_event_operator(p_event_id uuid)`: 최고관리자 또는 활성 행사 운영자 여부.
- `can_manage_event(p_event_id uuid)`: 최고관리자 또는 `OWNER/MANAGER`.
- `can_staff_event(p_event_id uuid)`: 최고관리자 또는 `OWNER/MANAGER/STAFF`.
- `can_view_event(p_event_id uuid)`: 최고관리자 또는 모든 활성 행사 권한.
- `is_operator_admin()`: `users.role = 'ADMIN'`.
- `is_super_admin()`: 기존 함수 유지.

### 3.2 RLS 변경 원칙

기존 전역 `ADMIN` 정책을 행사 범위 정책으로 바꿉니다.

- `events SELECT`: 최고관리자 전체, 일반 운영자는 배정 행사만.
- `events INSERT`: 최고관리자만. 필요 시 `OWNER` 생성까지 같은 트랜잭션에서 처리.
- `events UPDATE`: 최고관리자 또는 `can_manage_event(id)`.
- `event_participants`, `event_tables`, `matching_slots`, `matching_proposals`: 해당 `event_id` 기준 권한으로 제한.
- `notification_settings`: 최고관리자만.
- `event_notification_settings`: `can_manage_event(event_id)`.
- `notification_logs`: 최고관리자 또는 `can_view_event(event_id)`.
- `company_photos`: `can_staff_event(event_id)` 또는 기업 본인 조회.
- `audit_logs`: 최고관리자 전체, 일반 운영자는 배정 행사 관련 로그만 조회.

### 3.3 RPC 변경 원칙

관리자 전용 RPC 내부의 `current_app_role() <> 'ADMIN'` 가드는 행사 인자를 기준으로 다음처럼 바꿉니다.

- 행사 상태 강제 변경: 최고관리자 유지.
- 참가자 배정/테이블 관리/슬롯 생성/AI 배치/강제 배정: `can_manage_event(event_id)`.
- 출석 처리/사진 업로드: `can_staff_event(event_id)`.
- 리포트/엑셀 다운로드용 조회: `can_view_event(event_id)` 이상, 다운로드는 정책상 `MANAGER` 이상 권장.

---

## 4. 운영자 계정 관리

### 4.1 진입 경로

- 신규 메뉴: `운영자 관리`
- 경로: `/admin/operators`
- 접근: 최고관리자 전용

### 4.2 화면 구성

1. 운영자 목록
   - 이름, 이메일, 역할(`ADMIN`/`STAFF`), 최고관리자 여부, 활성 상태, 배정 행사 수, 최근 로그인, 생성일.
2. 운영자 생성/초대 모달
   - 이름, 이메일, 역할, 임시 비밀번호 또는 초대 메일 발송 옵션.
   - 최고관리자 지정은 별도 확인 문구를 요구합니다.
3. 운영자 상세
   - 기본 정보 수정.
   - 비활성화/재활성화.
   - 비밀번호 재설정 링크 또는 임시 비밀번호 발급.
   - 배정 행사 목록과 권한 등급.
4. 행사 권한 배정 모달
   - 행사 검색.
   - 권한 등급 선택.
   - 부여/회수 사유 입력.

### 4.3 Edge Function

Supabase Auth Admin API는 service role이 필요하므로 다음 Edge Function을 사용합니다.

- `operator-create`: Auth 사용자 생성 + `public.users` 운영자 행 생성.
- `operator-update`: 이름/역할/비활성화/최고관리자 플래그 변경.
- `operator-reset-password`: 비밀번호 재설정 또는 초대 링크 생성.
- `event-operator-grant`: 행사 권한 부여.
- `event-operator-revoke`: 행사 권한 회수.

모든 함수는 호출자의 Supabase Auth JWT를 확인하고, DB에서 `is_super_admin()`을 재검증해야 합니다.

---

## 5. 기존 관리자 화면 영향 범위

### 5.1 라우팅/네비게이션
- 최고관리자만 `/admin/operators`와 전역 `/admin/settings` 접근.
- 일반 관리자는 `/admin/events`에서 배정된 행사만 표시.
- 배정 행사가 없으면 빈 상태와 운영본부 문의 안내를 표시.

### 5.2 행사 목록/상세
- 행사 카드에 내 권한 배지(`OWNER`, `MANAGER`, `STAFF`, `VIEWER`)를 표시합니다.
- `STAFF/VIEWER`는 편집 버튼, AI 배치, 참가자 지정, 알림 설정 등을 숨기거나 비활성화합니다.
- 권한 없는 행사 URL 직접 접근은 Not Found 또는 권한 없음 안내로 처리합니다.

### 5.3 참가자 DB 관리
- 전역 참가자 DB(`/admin/users`)는 최고관리자 또는 정책상 허용된 전역 관리자만 접근합니다.
- 행사 상세의 참가자 배정 패널은 `can_manage_event(event_id)` 기준으로 동작합니다.

### 5.4 현장 스태프 화면
- `/staff/photos`, 향후 `/staff/check-in`은 배정 행사만 선택지에 노출합니다.
- `STAFF`가 배정되지 않은 행사 사진/출석 API를 직접 호출하면 RLS/RPC에서 차단되어야 합니다.

---

## 6. 감사 로그

다음 액션은 `audit_logs`에 기록합니다.

- 운영자 계정 생성/수정/비활성화/재활성화.
- 최고관리자 권한 부여/회수.
- 행사 권한 부여/권한 변경/회수.
- 운영자 비밀번호 재설정 또는 초대 링크 발급.
- 권한 부족으로 차단된 중요 RPC 호출은 서버 로그에 남기고, 필요 시 별도 보안 로그로 확장합니다.

권한 부여/회수 시 사유 입력을 필수로 받습니다.

---

## 7. 구현 슬라이스

### 슬라이스 A — DB 권한 모델
- `event_operator_roles` 테이블 추가.
- 권한 헬퍼 함수 추가.
- 주요 RLS를 행사 범위 기준으로 전환.
- 기존 최고관리자는 모든 행사 접근이 유지되는지 검증.

### 슬라이스 B — 운영자 Auth 관리 API
- Edge Function으로 운영자 생성/수정/비활성화/비밀번호 재설정 구현.
- `public.users.auth_user_id` 매핑을 원자적으로 보장.
- Auth 생성 성공 후 DB 실패 시 보상 처리 또는 실패 복구 절차 정의.

### 슬라이스 C — 운영자 관리 UI
- `/admin/operators` 라우트, 메뉴, 목록, 생성/수정 모달 구현.
- 최고관리자 전용 가드 적용.
- 감사 사유 입력과 결과 피드백 구현.

### 슬라이스 D — 행사별 권한 배정 UI
- 운영자 상세 또는 행사 상세에서 권한 부여/회수 가능.
- 행사 목록/상세에 내 권한 배지와 권한별 UI 잠금 반영.

### 슬라이스 E — 기존 관리자 기능 권한 스코프 적용
- 행사 목록, 상세, AI 배치, 알림 설정, 사진/출석, 엑셀 다운로드의 조회/변경 권한을 재검증.
- 일반 관리자/스태프/뷰어 계정별 통합 테스트 작성.

---

## 8. 검증 체크리스트

- 최고관리자는 운영자 계정을 생성하고 Supabase Auth 로그인이 가능한지 확인합니다.
- 일반 관리자는 배정된 행사만 목록에 보이고, 미배정 행사 URL 직접 접근이 차단됩니다.
- 일반 관리자는 배정 행사에서 참가자 배정, 테이블 관리, AI 배치, 리포트 확인이 권한 등급대로 동작합니다.
- 스태프는 배정된 행사 사진/출석만 처리할 수 있습니다.
- 뷰어는 조회만 가능하고 변경 RPC는 실패합니다.
- 최고관리자 전용 기능(운영자 관리, 전역 알림 설정, 상태 강제 변경)은 일반 관리자에게 노출되지 않습니다.
- 모든 권한 부여/회수/계정 변경이 감사 로그에 남습니다.
- anon, 미매핑 authenticated, 참가자 커스텀 JWT로 운영자 RPC 호출 시 차단됩니다.

---

## 9. 개발 시 주의사항

- `current_app_role()`의 NULL 우회 방지(`0017_admin_guard_null_fix.sql`) 전제를 유지합니다.
- RLS만 믿지 말고 권한이 중요한 RPC 내부에서도 같은 권한 헬퍼를 호출합니다.
- 기존 테스트 시드에 최고관리자, 일반 관리자, 행사 스태프, 뷰어 계정을 각각 추가합니다.
- `ADMIN`이라는 역할명은 "운영자 로그인 가능"을 뜻하고, 실제 행사 접근은 `event_operator_roles`가 결정하도록 문맥을 분리합니다.
