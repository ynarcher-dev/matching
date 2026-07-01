# 비즈니스 매칭 시스템 개발 개요

이 문서는 오프라인 비즈니스 매칭 행사를 운영하기 위한 웹 시스템의 목적, 사용자 시나리오, 아키텍처, 구현 기준을 정리한 통합 가이드입니다.

## 1. 문서 연동 가이드

작업을 시작할 때 아래 문서를 함께 확인합니다.

| 영역 | 관련 문서 |
| :--- | :--- |
| DB/RLS/RPC | [db_schema.md](./db_schema.md), [security_transactions.md](./security_transactions.md) |
| 인증/레이아웃 | [page_auth_layout.md](./page_auth_layout.md), [free_login_transition.md](./free_login_transition.md) |
| 관리자 행사 목록 | [page_admin_event_list.md](./page_admin_event_list.md) |
| 관리자 행사 상세 | [page_admin_event_detail.md](./page_admin_event_detail.md) |
| AI 배치 | [page_admin_ai_allocation.md](./page_admin_ai_allocation.md) |
| 참가자 DB | [page_admin_user_management.md](./page_admin_user_management.md) |
| 스타트업 포털 | [page_startup_booking.md](./page_startup_booking.md), [startup_portal_layout_simplification_plan.md](./startup_portal_layout_simplification_plan.md) |
| 전문가 대시보드 | [page_expert_dashboard.md](./page_expert_dashboard.md), [expert_dashboard_split_view_ideation.md](./expert_dashboard_split_view_ideation.md) |
| 운영자 권한 | [page_admin_operator_permissions.md](./page_admin_operator_permissions.md) |
| 알림 | [event_notification_api_plan.md](./event_notification_api_plan.md), [page_admin_notification_settings.md](./page_admin_notification_settings.md) |
| UI/UX | [uiux_rework_09_overview.md](./uiux_rework_09_overview.md), [uiux_responsive_review.md](./uiux_responsive_review.md) |

현재 구현 상태는 [development_status.md](./development_status.md)를 기준으로 봅니다.

## 2. 서비스 목적

이 시스템은 오프라인 비즈니스 매칭 행사에서 관리자, 현장 스태프, 전문가, 스타트업이 같은 운영 데이터를 공유하도록 돕습니다.

주요 목표는 다음과 같습니다.

- 행사 생성부터 예약, 배치, 진행, 결과 정리까지 한 화면 흐름으로 운영
- 스타트업이 직접 예약/변경/취소하고 상담 요청사항과 자료를 제출
- 전문가가 상담 대상 기업 자료를 보면서 상담일지를 즉시 작성
- 현장 노쇼, 대체 매칭, 출석 상태 같은 변수를 빠르게 반영
- 행사 종료 후 만족도, 상담 결과, 참가자 명단을 엑셀로 내보내기

## 3. 사용자 역할

- 최고관리자: 전체 행사, 참가자 DB, 알림 설정, 운영자 계정과 권한을 관리합니다.
- 행사 운영자: 부여받은 행사 범위 안에서 행사 상세, 배정, 진행, 결과를 관리합니다.
- 현장 스태프: 회사 사진 업로드와 현장 지원 업무를 수행합니다.
- 전문가: 배정된 상담 일정을 보고, 기업 자료를 확인하며, 상담일지를 작성합니다.
- 스타트업: 행사에 참여하고 상담 예약, 자료 업로드, 요청사항 입력, 만족도 응답을 수행합니다.

## 4. 행사 라이프사이클

행사 상태는 `events.status`로 관리됩니다.

1. `DRAFT`: 행사 설정, 참가자, 전문가, 테이블, 기본 데이터를 준비합니다.
2. `BOOKING`: 스타트업이 가능한 슬롯을 직접 예약합니다.
3. `ALLOCATION`: 직접 예약 이후 관리자와 AI 배치가 슬롯을 조정합니다.
4. `PROGRESS`: 현장 진행 단계입니다. 상담 시작, 출석, 노쇼 대체, 상담일지 제출이 활성화됩니다.
5. `FINISHED`: 만족도, 결과 리포트, 엑셀 내보내기를 중심으로 운영합니다.
6. `CANCELLED`: 취소된 행사로 일반 운영 대상에서 제외합니다.

## 5. 현재 구현된 핵심 흐름

### 관리자

- 행사 목록과 상세 운영
- 참가자 DB와 CSV 업로드
- 전문가/스타트업 배정
- 테이블 생성과 담당자 지정
- 슬롯 자동 생성, 식사시간/중단 구간 반영
- AI 배치 제안과 확정
- 노쇼 대체 매칭
- 결과 엑셀 내보내기
- 알림 설정과 발송 로그 확인
- 운영자 계정과 행사별 권한 관리

### 스타트업

- 이름+휴대전화 기반 참가자 로그인
- 참여 행사 선택
- 상담 예약, 변경, 취소
- 상담 요청사항 입력
- 사업소개서/IR PDF 업로드
- 참고 URL 다중 등록/삭제
- 행사 종료 후 만족도 응답과 공개 코멘트 확인

### 전문가

- 참여 행사와 상담 일정 확인
- 상담 대상 기업 선택 후 Split View 진입
- 기업 PDF, 회사 정보, 요청사항, 참고 URL 열람
- 상담 시작 시 세션 진행 상태와 출석 자동 처리
- 행사별 동적 상담일지 작성
- 자동 임시저장, 수동 저장, 최종 제출
- 제출 취소 후 재편집

### 현장

- 회사별 현장 사진 업로드
- 관리자 화면에서 업로드 현황 확인
- 진행 상태 기반 출석 동기화와 노쇼 대체 흐름 지원

## 6. 아키텍처 기준

- Frontend: React SPA, Vite, TypeScript
- Styling: Tailwind CSS v4와 공통 컴포넌트
- Server/Data: Supabase Postgres, RLS, RPC, Storage, Edge Functions
- 운영자 인증: Supabase Auth
- 참가자 인증: 참가자 전용 JWT와 `participantClient`
- 캐시/동기화: TanStack Query
- 상태 저장: Zustand

중요한 상태 변경은 클라이언트에서 직접 테이블을 수정하지 않고 RPC를 통해 처리합니다. RLS는 조회 범위를 제한하고, RPC는 권한과 상태 전이를 최종 검증합니다.

## 7. 데이터 보안 원칙

- 운영자는 본인이 권한을 가진 행사 범위만 조회/수정합니다.
- 최고관리자는 전역 참가자 DB와 운영자 계정을 관리합니다.
- 참가자는 본인 정보와 본인이 참여한 행사 데이터만 조회합니다.
- 전문가는 같은 행사에 배정된 스타트업 정보와 본인 상담 슬롯만 조회합니다.
- Storage 자료는 소유자, 관리자, 같은 행사 참여자 범위를 기준으로 제한합니다.
- 새 SECURITY DEFINER RPC는 `PUBLIC`/`anon` 권한을 명시적으로 회수하고 필요한 역할에만 `EXECUTE`를 부여합니다.

## 8. UI/UX 기준

- 첫 화면은 실제 업무 화면을 우선합니다. 별도 랜딩 페이지는 만들지 않습니다.
- 관리자 화면은 반복 운영에 맞게 조용하고 밀도 있게 구성합니다.
- 스타트업/전문가 포털은 모바일 현장 사용을 고려해 주요 액션을 크게 배치합니다.
- 공통 컴포넌트(`Badge`, `Tabs`, `SegmentedControl`, `PageToolbar`, `DataTable`, `PhotoPicker`, `ResizableSplit`)를 우선 사용합니다.
- Split View는 데스크톱에서 좌우 분할, 태블릿/모바일에서 상하 스택으로 동작합니다.
- 주요 뷰포트 검증 대상은 360px, 768px, 1024px, 1440px입니다.

## 9. 남은 통합 과제

- 실 알림 사업자 연동과 운영 환경 Cron 설정
- 알림 발송 성공/실패 운영 검증
- 주요 사용자 경로 E2E 검증
- 실제 모바일 기기에서 사진 업로드와 상담 워크스페이스 검증
- 감사 로그 화면과 일부 운영 보조 UX 보강
