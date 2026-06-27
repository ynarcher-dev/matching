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

## 3. 관리자 UI 범위

### 3.1 전역 알림 설정

위치 후보:

```text
/admin/settings/notifications
```

또는 기존 관리자 설정 영역이 없다면 행사 상세의 알림 탭 안에서 "전역 설정 상태"를 읽기 전용으로 먼저 노출한다.

필수 UI:

- `실제 발송 활성화` 토글
- 공급사 선택: `Mock`, `Solapi`
- 공급사 설정 상태: API 키, API Secret, 발신번호, dispatch secret, 템플릿 묶음
- 테스트 발송 버튼
- 마지막 테스트 발송 결과
- 현재 모드 배지: `무료 운영`, `Mock`, `실발송 가능`, `설정 불완전`

주의:

- API Secret 원문은 일반 화면에 노출하지 않는다.
- 환경변수 기반 설정이면 관리자 UI에는 설정 여부만 표시한다.
- 토글 ON 전에 테스트 발송 성공 또는 명시 확인 절차를 둔다.

### 3.2 행사별 알림 설정

위치 후보:

```text
/admin/events/:eventId
```

행사 상세에 `알림 설정` 탭 또는 기존 알림 현황 탭의 설정 섹션으로 둔다.

필수 UI:

- 알림 채널 정책
  - `발송 안 함` (기본)
  - `카카오 알림톡만`
  - `SMS만`
  - `카카오 알림톡 + SMS fallback`
- 이벤트별 ON/OFF 토글
  - 예약 시작 안내
  - 예약 생성 안내
  - 예약 변경 안내
  - 예약 취소 안내
  - 미예약 스타트업 리마인드
  - 행사 전 리마인드
- 사용할 템플릿 묶음 선택
- 현재 발송 가능 여부와 차단 사유 표시
- 테스트 발송 또는 미리보기

행사별 기본값:

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
