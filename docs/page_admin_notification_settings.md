# 관리자 알림 설정 및 발송 활성화 명세

> 작성일: 2026-06-28  
> 상태: Phase 7 알림 후속 구현 상세 기준.  
> 선행 문서: [`event_notification_api_plan.md`](./event_notification_api_plan.md), [`free_auth_notification_planning.md`](./free_auth_notification_planning.md)

## 1. 목표

알림 기능과 공급사 어댑터는 미리 개발해두되, 실제 외부 발송은 관리자 페이지에서 명시적으로 활성화한 경우에만 수행한다.

기본 운영 원칙:

- 기본값은 항상 비활성이다.
- 무료 운영 모드에서는 외부 API를 호출하지 않는다.
- 전역 발송 토글, 행사별 정책, 이벤트별 토글, 공급사 설정이 모두 유효할 때만 실제 발송한다.
- 설정이 꺼져 있거나 불완전하면 Mock 또는 `발송 안 함`으로 안전하게 동작한다.

## 2. 필수 활성화 게이트

실제 발송은 아래 조건을 모두 만족해야 한다.

```text
전역 실제 발송 활성화 = ON
행사별 알림 채널 정책 != 발송 안 함
해당 이벤트 토글 = ON
공급사 API 키/시크릿/발신번호/템플릿 설정 유효
테스트 발송 성공 또는 관리자가 설정 유효성을 확인
```

하나라도 만족하지 않으면 외부 API를 호출하지 않는다.

권장 판정 함수:

```text
canDispatchExternally(globalSettings, eventNotificationSettings, eventType, providerStatus)
```

반환값은 단순 boolean보다, 차단 사유를 함께 주는 형태를 권장한다.

```text
{
  enabled: false,
  reason: "GLOBAL_DISABLED" | "EVENT_DISABLED" | "EVENT_TYPE_DISABLED" | "PROVIDER_NOT_CONFIGURED" | "TEMPLATE_MISSING"
}
```

## 3. 관리자 UI 범위 (Notification Admin UI)

### 3.1 전역 안내발송 관리 (`NotificationSettingsView.tsx`)
- **라우트**: `/admin/settings` (메뉴명: `안내발송 관리` - 최고관리자 전용 접근 가능)
- **화면 목적**: 시스템 전체의 전역 발송 허용 상태 및 공급사 연동 설정을 제어합니다.
- **주요 UI 구성 요소**:
  - **현재 발송 모드 배지**: 전역 설정값과 발신번호 정합성을 바탕으로 현재 발송 상태를 동적으로 판정하여 배지로 노출합니다.
    - `FREE_OPERATION` (무료 운영): 실제 발송 토글 OFF 상태이며, 외부 API를 호출하지 않고 수동 안내 및 현장 1회용 링크를 사용합니다.
    - `MOCK` (모킹 모드): Mock 공급사가 선택되어 실제 메시지 발송 없이 DB 발송 큐 로그만 생성합니다.
    - `LIVE` (실제 발송): Solapi 공급사가 설정되어 실제 SMS/알림톡 발송 및 요금 청구가 발생합니다.
    - `INCOMPLETE` (설정 불완전): Solapi를 선택했으나 발신번호(`sender_phone`)를 미지정한 상태입니다.
  - **발송 설정 폼 (`globalNotificationSettingsSchema`)**:
    - `실제 발송 활성화` 토글 스위치 (`dispatch_enabled`).
    - 공급사 라디오 선택: `MOCK` (Mock 발송 어댑터) 또는 `SOLAPI` (솔라피 API 연동 어댑터).
    - `발신번호` 입력 필드: Solapi에 사전 등록된 발송 번호(숫자만 입력).
    - *보안*: Solapi API 키와 Secret 정보는 화면에 노출되지 않도록 DB 저장을 배제하고 Supabase Edge Function 환경변수(`SOLAPI_API_KEY`, `SOLAPI_API_SECRET` 등)로 은폐 관리합니다.
  - **테스트 발송 카드 (`useTestNotification`)**:
    - 임의의 수신인 휴대전화 번호를 입력해 즉시 테스트 발송을 수행하는 영역.
    - 전역 발송 활성화 여부(`dispatch_enabled = false`)와 무관하게 공급사 키 및 발신번호 설정의 유효성을 실시간으로 확인하는 도구로 활용됩니다.
    - 테스트 발송 성공/실패 여부 및 최종 테스트 시각(`last_tested_at`)을 이력으로 관리 및 갱신합니다.

### 3.2 행사별 행사알림 설정 (`EventNotificationSettingsPanel.tsx`)
- **위치**: 행사 상세 페이지 `/admin/events/:eventId` 내의 **"행사알림"** 탭.
- **주요 UI 구성 요소**:
  - **알림 채널 정책 라디오 그룹**:
    - `발송 안 함` (기본값)
    - `카카오 알림톡만`
    - `SMS만`
    - `카카오 알림톡 + SMS fallback` (알림톡 전송 실패 시 SMS로 자동 교체 발송)
  - **이벤트별 발송 ON/OFF 토글**:
    - 예약 시작 안내 (`send_booking_open`)
    - 예약 생성 안내 (`send_booking_created`)
    - 예약 변경 안내 (`send_booking_changed`)
    - 예약 취소 안내 (`send_booking_cancelled`)
    - 미예약 스타트업 리마인드 (`send_unbooked_reminder`)
    - 행사 전 리마인드 (`send_event_reminder`)
  - **발송 게이트웨이 판정 정보**:
    - 전역 설정 상태 및 현재 행사의 알림 정책, 필수 키 세팅 정합성을 교차 검증하여 실제 외부 API 발송이 이루어질 수 있는지에 대한 가능 여부와 구체적 차단 사유를 안내 배너로 실시간 표시합니다.
  - **알림 이력 목록 (`NotificationLogPanel`)**:
    - 해당 행사에서 발생한 알림 발송 큐 목록(수신인, 발송 내용, 채널, 상태 배지: `PENDING`, `SENT`, `FAILED`, `SKIPPED`, 시각)을 공통 `DataTable` 형태로 목록화하여 조회 및 감시 기능을 제공합니다.

행사별 알림 설정 기본값:
```text
notification_policy = NONE
send_booking_open = false
send_booking_created = false
send_booking_changed = false
send_booking_cancelled = false
send_unbooked_reminder = false
send_event_reminder = false
```

## 4. 데이터 모델 기준

기존 `notification_logs`와 `notification-dispatch` 인프라를 재사용한다.

신규 또는 확장 후보:

```text
notification_settings
- id
- provider
- dispatch_enabled
- sender_phone
- provider_configured_at
- last_tested_at
- last_test_status
- updated_by
- updated_at

event_notification_settings
- event_id
- notification_policy
- template_set_id nullable
- send_booking_open boolean
- send_booking_created boolean
- send_booking_changed boolean
- send_booking_cancelled boolean
- send_unbooked_reminder boolean
- send_event_reminder boolean
- updated_by
- updated_at
```

API 키/시크릿은 DB 저장보다 Supabase Edge Function 환경변수를 우선한다. DB에 저장해야 한다면 암호화/권한/감사 로그 기준을 별도로 확정해야 한다.

## 5. 발송 동작

### 5.1 비활성 상태

전역 토글 OFF 또는 행사 정책 `발송 안 함`이면:

- 외부 API를 호출하지 않는다.
- 발송 버튼은 비활성화하거나 `발송 안 함` 상태를 명확히 보여준다.
- 로그 생성 정책은 구현 시 결정하되, 추천은 "실제 발송 대상 큐를 만들지 않음"이다.
- 필요하면 운영 감사용으로 `SKIPPED` 상태 로그를 남길 수 있다.

### 5.2 활성 상태

모든 게이트가 통과되면:

- 이벤트별 템플릿과 수신자 정보를 검증한다.
- 중복 방지 키로 같은 이벤트의 중복 발송을 막는다.
- `notification_logs`에 PENDING을 생성한다.
- `notification-dispatch`가 공급사 어댑터로 발송한다.
- 결과를 SENT/FAILED/SKIPPED로 기록한다.

### 5.3 Fallback

`카카오 알림톡 + SMS fallback` 정책:

```text
1. 알림톡 발송 시도
2. 공급사 실패 또는 fallback 대상이면 SMS 발송 가능 여부 재검증
3. SMS 발송 로그 생성
4. SMS 발송 시도
5. 알림톡/SMS 결과를 각각 기록
```

전역 토글이나 행사 토글이 중간에 OFF가 되면 fallback도 중단한다.

## 6. 완료 기준

- 전역 `실제 발송 활성화` 토글이 기본 OFF다.
- 행사별 정책 기본값이 `발송 안 함`이다.
- 전역 OFF 상태에서 어떤 UI/Edge/RPC 경로도 외부 API를 호출하지 않는다.
- 행사 정책 `발송 안 함` 상태에서 외부 API를 호출하지 않는다.
- 공급사 설정이 불완전하면 외부 API를 호출하지 않고 차단 사유를 보여준다.
- 정책 ON + 이벤트 토글 ON + 공급사 설정 유효 + 테스트 발송 성공 시 실제 발송 경로가 열린다.
- Mock 모드와 실제 공급사 모드가 명확히 분리된다.
- 발송 로그에서 SENT/FAILED/SKIPPED/PENDING 상태를 구분할 수 있다.
- 실패 건 수동 재시도는 동일 게이트를 다시 통과해야 한다.

## 7. 구현 전 확인

작업 지시 또는 구현 시작 전에 아래를 반드시 읽는다.

1. [`event_notification_api_plan.md`](./event_notification_api_plan.md)
2. 이 문서
3. [`development_status.md` Phase 7](./development_status.md)
4. 기존 알림 인프라 코드: `_shared/notifier.ts`, `notification-dispatch`, `notification_logs` 관련 마이그레이션/훅/패널

이 기능은 비용이 발생할 수 있으므로, "코드가 존재한다"와 "실제 발송이 켜져 있다"를 항상 분리해서 구현한다.
