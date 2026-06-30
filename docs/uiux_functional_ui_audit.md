# UI/UX Functional UI Audit

작성일: 2026-06-28  
상태: UI/UX 전면 개편 전 기능성 UI 전수 분석 문서  
범위: 데이터 구조 변경 없이 화면, 공통 컴포넌트, 조작 UI, 반응형 UX를 개편하기 위한 사전 분석

> 이 문서는 문서 작업 전용이다. `development_status.md`에는 반영하지 않는다.

## 1. 목적

현재 서비스는 기능 구현이 넓게 진행되어 있지만, 기능성 UI가 페이지별로 직접 조합되어 있다. 드롭다운, 탭, 필터칩, 토글, 모달, 테이블 액션, 파일 업로드, 사진 업로드, 출석 세그먼트, 만족도 입력 같은 조작 UI가 서로 다른 스타일과 인터랙션 규칙으로 구현되어 있어 전면 UI/UX 개편 전에 공통 기준을 세울 필요가 있다.

이 문서의 목적은 다음과 같다.

- 모든 기능성 UI의 위치와 역할을 파악한다.
- 드롭다운 및 선택 UI의 일관성 문제를 분석한다.
- 공통 컴포넌트로 끌어올릴 대상과 페이지에 남겨야 할 도메인 UI를 분리한다.
- 데이터 구조 변경 없이 적용 가능한 개편 방향을 정리한다.
- 이후 디자인 시스템, 레이아웃, 페이지별 리디자인 작업의 기준 문서로 사용한다.

## 2. 분석 범위

### 2.1 공통 UI

- `src/components/common/AppShell.tsx`
- `src/components/common/Header.tsx`
- `src/components/common/Sidebar.tsx`
- `src/components/common/Button.tsx`
- `src/components/common/Card.tsx`
- `src/components/common/Modal.tsx`
- `src/components/common/ConfirmModal.tsx`
- `src/components/common/DataTable.tsx`
- `src/components/common/FilterBar.tsx`
- `src/components/common/Pagination.tsx`
- `src/components/common/TextField.tsx`
- `src/components/common/SelectField.tsx`
- `src/components/common/Toggle.tsx`
- `src/components/common/Alert.tsx`

### 2.2 주요 화면

- 로그인: `src/views/LoginView.tsx`
- 관리자 행사 목록: `src/views/admin/EventListView.tsx`
- 관리자 행사 상세: `src/views/admin/EventDetailView.tsx`
- AI 배정: `src/views/admin/AiAllocationView.tsx`
- 스타트업/전문가 DB: `src/views/admin/ParticipantDbView.tsx`
- 알림 설정: `src/views/admin/NotificationSettingsView.tsx`
- 운영자 관리: `src/views/admin/OperatorListView.tsx`
- 스타트업 예약: `src/views/startup/StartupPortalView.tsx`
- 전문가 대시보드/이력: `src/views/expert/ExpertDashboardView.tsx`, `src/views/expert/ExpertHistoryView.tsx`
- 현장 사진: `src/views/staff/StaffPhotosView.tsx`

### 2.3 도메인 기능성 컴포넌트

- 행사/권한/상태: `EventCard`, `EventDetailHeader`, `EventStatusBadge`, `EventPermissionBadge`
- 참가자 지정: `ParticipantAssignPanel`, `UserDetailModal`, `FieldMultiSelect`, `ParticipantFileInput`
- 테이블/슬롯/진행: `EventTablesPanel`, `SlotGenerationPanel`, `SlotForcePanel`, `TimeGridSheet`, `ProgressDashboardPanel`
- AI 배정: `AllocationToolbar`, `AllocationSlotBoard`, `ProposalSlotCard`, `UnmatchedPanel`
- 상담/만족도: `CounselingBuilderPanel`, `CounselingReportPanel`, `SurveyBuilderPanel`, `SurveyReportPanel`, `ExpertSurveyReportPanel`
- 알림: `EventNotificationSettingsPanel`, `NotificationLogPanel`
- 운영자 권한: `OperatorTable`, `OperatorFormModal`, `OperatorPermissionModal`, `EventOperatorAssignModal`
- 예약: `BookingSlotsGrid`, `MyBookingList`, `ChangeBookingModal`
- 전문가 진행: `ActiveSessionCard`, `ExpertAttendanceControl`, `CounselingLogModal`, `ExpertScheduleList`
- 사진: `CompanyPhotoList`, `CompanyPhotoUploadPanel`, `PhotoStatusPanel`

## 3. 기능성 UI 인벤토리

| 유형 | 현재 구현 | 주요 위치 | 평가 |
| :--- | :--- | :--- | :--- |
| 드롭다운 | `SelectField` + 직접 `<select>` 혼재 | 행사 폼, 운영자/권한 모달, 현장 행사 선택, 강제 배정, 기본 테이블, AI 제안 이동 | 공통 스타일 일부 존재. 검색형/대량 선택/상태 설명이 필요한 곳에는 부족 |
| 탭/세그먼트 | 직접 버튼 반복, `RoleTabs`, `FilterChips` | 로그인, 행사 목록 필터, 행사 상세 탭, 예약 보기 전환, 리포트 역할 전환 | 가장 많이 중복됨. 공통 `Tabs`/`SegmentedControl` 필요 |
| 필터칩 | `FilterChips` 일부 사용, 직접 버튼 다수 | 참가자 DB, 행사 목록, 행사 상세, 스타트업/전문가 행사 선택 | 선택 상태 스타일은 비슷하나 API와 접근성 규칙이 분산 |
| 검색 | `SearchInput` + 직접 input 혼재 | 참가자 DB, 행사 목록, 운영자 관리, 참가자 지정, 사진 목록 | 공통 검색은 일부만 적용. 지우기/디바운스/결과 수 표시 부족 |
| 토글 | `Toggle`, checkbox, radio 혼재 | 자율 예약 허용, 진단 정보, 문항 필수, 알림 설정 | boolean 조작의 표현이 세 가지로 나뉨 |
| 모달 | `Modal`, `ConfirmModal` 중심 | 대부분 생성/수정/삭제/설정/권한/상담일지/예약 변경 | 재사용성은 좋으나 크기, footer, nested modal, 모바일 높이 기준 정교화 필요 |
| 테이블 | `DataTable` 일부 적용, 직접 table 다수 | 참가자 DB, 운영자, 알림 로그, 슬롯/진행/결과 | 공통화 진행 중. 목록형 관리자 화면은 더 통일 필요 |
| 페이지네이션 | `Pagination` 일부 적용 | 참가자 DB | 많은 결과/로그/리포트 화면으로 확대 필요 |
| 파일 업로드 | `ParticipantFileInput`, `CsvBulkUploader`, 직접 file input | 참가자 파일, CSV, 현장 사진 | 기능은 있음. 업로드 진행/오류/미리보기 패턴이 분산 |
| 사진 UI | 직접 input + preview grid | 현장 사진, 관리자 사진 상태 | 모바일 현장 UX 기준으로 별도 패턴 필요 |
| 출석 세그먼트 | 직접 세그먼트 버튼 | `TimeGridSheet`, `ExpertAttendanceControl` | 도메인 UI로 중요. 공통 `SegmentedControl` 기반으로 정리 가능 |
| 만족도 입력 | rating/options/text 직접 구성 | `surveyFields`, `CounselingLogModal` | 재사용 후보. 접근성/터치 크기/읽기 전용 상태 강화 필요 |
| 행 액션 | 작은 텍스트 버튼 직접 구현 | 참가자 DB, 운영자, 슬롯, 로그 | `RowAction`, `ActionMenu`, 아이콘 버튼 체계 필요 |
| 상태 배지 | 전용/직접 스타일 혼재 | 행사 상태, 권한, 세션, 알림, 파일 상태 | 공통 `Badge`/`StatusBadge` 우선 필요 |

## 4. 드롭다운 및 선택 UI 상세 분석

### 4.1 공통 SelectField

현재 `SelectField`는 라벨, 에러, options를 받는 단순 native select이다. 행사 폼, 운영자 폼, 운영자 권한 모달, 행사 운영자 배정 모달, 설문/상담 문항 타입 선택 등에서 사용된다.

장점:

- react-hook-form과 함께 쓰기 쉽다.
- 라벨/에러/포커스 스타일이 공통화되어 있다.
- 데이터 구조 변경 없이 유지 가능하다.

한계:

- 검색이 필요한 긴 목록에는 부적합하다.
- 옵션 설명, 비활성 사유, 상태 배지를 함께 보여줄 수 없다.
- 모바일에서 native select는 괜찮지만 데스크톱 운영툴에서는 정보 밀도가 낮다.
- 직접 `<select>`와 스타일 차이가 생긴다.

개편 방향:

- 기본 `SelectField`는 유지하되 `size`, `tone`, `placeholder`, `helperText`, `fullWidth`, `disabledReason`을 추가한다.
- 긴 목록용으로 `SearchableSelect` 또는 `Combobox`를 별도 도입한다.
- 권한/운영자/참가자/스타트업 선택처럼 설명이 필요한 목록은 `OptionMeta` 구조를 UI 레벨에서 지원한다.

### 4.2 직접 select 사용 지점

직접 `<select>` 사용 위치:

- `ForceBookingModal`: 강제 배정할 스타트업 선택
- `ParticipantAssignPanel`: 전문가 기본 테이블 선택
- 일부 도메인 제안 이동 UI는 `SelectField` 사용

문제:

- 공통 라벨/에러/도움말 구조가 없다.
- 옵션이 많아졌을 때 검색이 불가능하다.
- 비활성 옵션의 이유가 텍스트로만 묻힌다.
- 직접 className을 반복한다.

개편 방향:

- 직접 `<select>`는 모두 `SelectField` 또는 `InlineSelect`로 치환한다.
- 테이블 행 안의 작은 선택은 `InlineSelect`로 별도 규격화한다.
- 강제 배정처럼 후보 수가 많고 충돌 상태가 있는 경우는 `SearchableSelect`로 전환한다.

### 4.3 다중 선택 UI

현재 다중 선택은 대부분 버튼 칩 방식이다.

- `FieldMultiSelect`: 분야 최대 3개 선택
- `ParticipantAssignPanel`: 후보 참가자 다중 선택 후 일괄 추가
- 설문/상담 객관식: 단일/다중 선택 칩

장점:

- 터치 친화적이고 빠르다.
- 현재 선택 상태가 즉시 보인다.

한계:

- 선택 수 제한, 비활성 사유, 선택 요약이 일관되지 않다.
- 많은 항목에서는 스크롤 칩 목록이 길어진다.
- keyboard navigation과 aria 패턴이 충분하지 않다.

개편 방향:

- `MultiSelectChips` 공통 컴포넌트로 통합한다.
- `max`, `selectedCount`, `emptyMessage`, `searchable`, `disabledReason`을 지원한다.
- 후보가 많으면 `CommandPicker` 또는 `SearchableMultiSelect`로 분리한다.

## 5. 공통 컴포넌트 분석

### 5.1 Button

현재 `primary`, `outline` 두 variant만 있다. 대부분의 액션이 버튼으로 구현되어 있어 역할 구분이 약하다.

필요 variant:

- `primary`: 주요 저장/확정
- `secondary`: 보조 액션
- `outline`: 중립 보조
- `ghost`: 테이블/툴바 가벼운 액션
- `danger`: 삭제/취소/권한 회수
- `link`: 텍스트형 이동

추가 필요:

- `size`: `sm`, `md`, `lg`, `icon`
- `leftIcon`, `rightIcon`
- `loadingText`
- 모바일 터치 최소 높이 규칙

### 5.2 Card

현재 `rounded-2xl border shadow-sm`가 기본이다. 운영형 화면에는 다소 부드럽고, 테이블/패널/모달과 radius가 섞인다.

개편 방향:

- 기본 radius를 `rounded-lg` 또는 `rounded-xl`로 낮춘다.
- `Card`는 반복 항목, 모달 내부 섹션, 요약 카드에 한정한다.
- 페이지 섹션 전체를 카드처럼 감싸는 패턴은 줄인다.
- `Panel`, `StatCard`, `EmptyState`를 분리한다.

### 5.3 Modal / ConfirmModal

현재 모달 스택과 Esc 처리가 있어 기반은 좋다. 생성/수정/삭제/상세/설정에 광범위하게 사용된다.

개선 필요:

- `size`가 `md | lg`뿐이라 상담일지/권한/사진처럼 정보량이 많은 모달에 부족하다.
- footer 정렬과 sticky footer 규칙이 더 필요하다.
- nested modal 사용 시 배경 스크롤/포커스 trap 검토 필요.
- 모바일 bottom sheet처럼 보이는 현재 구조는 좋지만 큰 폼에서는 단계화가 필요하다.

권장:

- `size`: `sm`, `md`, `lg`, `xl`, `fullscreenMobile`
- `description`, `actions`, `dangerAction`
- 스크롤 영역과 footer 고정 규칙 표준화

### 5.4 DataTable / Pagination

`DataTable`은 참가자 DB에 적용되어 있으며 정렬, 로딩, 에러, 빈 상태를 처리한다. 하지만 아직 많은 관리자 목록은 직접 table 또는 카드/리스트다.

확대 대상:

- 행사 목록
- 운영자 목록
- 알림 로그
- 상담일지 결과
- 행사 만족도 결과
- 전문가 만족도 결과
- 증빙사진 상태
- 참가자 지정 현재 목록
- 슬롯 강제 조정 목록

추가 필요:

- density: `compact`, `normal`
- sticky header 옵션
- row action slot
- mobile fallback row/card
- bulk selection
- column visibility
- server pagination 준비

### 5.5 FilterBar / SearchInput / FilterChips

일부 화면에서만 공통화되어 있다. 행사 목록/상세/예약 화면에는 유사한 버튼 필터가 직접 구현되어 있다.

개편 방향:

- `Toolbar` 또는 `PageToolbar`로 검색, 필터, 우측 액션을 통합한다.
- `FilterChips`는 `SegmentedControl`과 구분한다.
- 필터 초기화, 결과 수, 활성 필터 요약을 추가한다.

### 5.6 Toggle

현재 `Toggle`은 버튼 기반 on/off 스위치다. checkbox/radio와 함께 혼재한다.

원칙:

- 즉시 반영되는 boolean 설정은 `Toggle`
- 폼 안에서 저장 전까지 보류되는 boolean은 `Checkbox`
- 여러 값 중 하나 선택은 `RadioGroup` 또는 `SegmentedControl`

현재 혼재 지점:

- 전역 알림 설정은 checkbox
- 행사 알림 이벤트 on/off도 checkbox
- 자율 예약 허용은 Toggle
- 문항 필수 여부는 Toggle
- 진단 정보 표시는 Toggle

개편 시 알림 설정 화면은 `SwitchGroup`으로 정리하는 것이 좋다.

## 6. 페이지별 기능성 UI 분석

### 6.1 로그인

위치:

- `LoginView`
- `RoleTabs`
- `ParticipantLoginForm`
- `OperatorLoginForm`

기능성 UI:

- 역할 탭
- 이름/휴대전화 또는 운영자 이메일/비밀번호 입력
- submit 버튼 loading

문제:

- 역할 탭은 로그인 전용 컴포넌트라 다른 탭과 스타일 연계가 약하다.
- 입력 폼은 단순하고 좋지만 로그인 카드가 전체 디자인 톤을 대표하기에는 시각 시스템이 얇다.

개편 방향:

- `Tabs` 기반으로 재구성한다.
- 로그인은 브랜드 첫인상이므로 토큰/버튼/입력의 기준 화면으로 삼는다.

### 6.2 관리자 행사 목록

위치:

- `EventListView`
- `EventCard`
- `EventFormModal`
- `CancelEventModal`

기능성 UI:

- 상태 필터 버튼
- 행사명 검색
- 행사 카드 액션: 상세, 편집, 취소
- 행사 생성/수정 모달
- 행사 취소 사유 모달

문제:

- 백오피스 관리 화면인데 카드 그리드 중심이라 행사 수가 많아지면 스캔 효율이 낮다.
- 필터 버튼이 공통 `FilterChips`가 아니라 직접 구현되어 있다.
- 카드 안 액션 버튼 우선순위가 다소 평면적이다.

개편 방향:

- 데스크톱 기본은 `DataTable`, 모바일은 compact event card.
- 상태/기간/권한/취소 여부 필터를 `FilterBar`로 통합한다.
- 행사 생성은 primary, 편집/취소는 row action 또는 action menu로 이동한다.

### 6.3 관리자 행사 상세

위치:

- `EventDetailView`
- `EventDetailHeader`
- `EventTablesPanel`
- `ParticipantAssignPanel`
- `BookingStatsPanel`
- `SlotForcePanel`
- `ProgressDashboardPanel`
- `CounselingReportPanel`
- `SurveyReportPanel`
- `ExpertSurveyReportPanel`
- `PhotoStatusPanel`
- `NotificationLogPanel`

기능성 UI:

- 행사 권한 배지
- 자율 예약 허용 Toggle
- 상세 탭
- 운영자 배정 모달
- 엑셀 export
- 참가자 추가 다중 선택
- 전문가 기본 테이블 select
- 테이블 생성/수정/삭제
- 슬롯 생성/초기화
- 강제 배정/취소
- 진행 현황 출석 세그먼트
- 상담/만족도/알림 설정 모달

문제:

- 탭 수가 많고 직접 버튼으로 구현되어 있어 정보 구조가 무겁다.
- 설정성 UI와 결과성 UI가 한 화면에 섞여 있으나 최근에는 모달 분리 방향으로 개선 중이다.
- 동일한 "설정" 버튼이 여러 탭에서 반복되지만 위치/라벨 체계가 통일되어 있지 않다.
- 참가자 지정과 진행/결과 화면의 목록 UI가 아직 공통 테이블 규칙으로 완전히 통일되지 않았다.

개편 방향:

- `PageHeader`: 행사명, 상태, 권한, 기간, 주요 액션 정리
- `Tabs`: desktop scrollable tabs + mobile select/segmented fallback 검토
- `SettingsButton`: 탭 우측 상단 고정 패턴
- `ResultPanel`: 상담/만족도/알림 결과 화면 공통화
- 참가자 지정/로그/결과는 `DataTable` 기반으로 전환

### 6.4 AI 배정

위치:

- `AiAllocationView`
- `AllocationToolbar`
- `AllocationSlotBoard`
- `ProposalSlotCard`
- `UnmatchedPanel`

기능성 UI:

- 제안 생성
- 제안 확정 ConfirmModal
- proposal lock toggle 버튼
- 빈 슬롯 이동 SelectField
- 확정 결과 리포트

문제:

- AI 배정은 별도 색상/톤이 필요한데 현재 violet 계열이 직접 사용된다.
- lock, 이동, 확정의 위험도 차이가 충분히 시각적으로 구분되지 않는다.
- 드래그/드롭 명세가 문서에는 있으나 현재 UI는 select 이동 중심이다.

개편 방향:

- `ai` tone 토큰을 정의한다.
- proposal card는 `locked`, `changed`, `conflict`, `recommended` 상태를 배지화한다.
- 이동 select는 후보가 많으면 searchable select로 전환한다.
- 확정 전 요약을 상단 sticky toolbar로 유지한다.

### 6.5 참가자 DB

위치:

- `ParticipantDbView`
- `DataTable`
- `FilterBar`
- `Pagination`
- `UserDetailModal`
- `CsvBulkUploader`
- `EmergencyLinkModal`
- `FieldMultiSelect`
- `ParticipantFileInput`

기능성 UI:

- 검색
- 파일 첨부 필터
- 로그인 이력 필터
- 진단 정보 Toggle
- 정렬 테이블
- 페이지네이션
- 개별 추가/수정 모달
- CSV 업로드 모달
- 세션 무효화 ConfirmModal
- 1회용 링크 발급 모달
- 분야 다중 선택
- IR/프로필 파일 업로드/삭제/보기

장점:

- 현재 프로젝트에서 공통 테이블 인프라가 가장 잘 적용된 화면이다.
- 페이지네이션과 필터 구조가 이후 관리자 목록의 기준이 될 수 있다.

문제:

- 일부 row action이 텍스트 버튼 나열이라 밀도가 높아질수록 복잡하다.
- 파일/로그인/진단 정보는 Badge로 표현하면 더 빠르게 스캔된다.
- CSV 업로드는 검증 결과, 오류, 완료 상태의 시각 체계가 별도 필요하다.

개편 방향:

- `RowActionGroup` 또는 `ActionMenu` 도입
- 파일 상태 `FileBadge`, 로그인 상태 `SessionBadge`
- CSV 업로드는 stepper 또는 validation table 적용

### 6.6 전역/행사 알림 설정

위치:

- `NotificationSettingsView`
- `EventNotificationSettingsPanel`
- `NotificationLogPanel`

기능성 UI:

- 전역 dispatch checkbox
- provider radio
- sender phone input
- 테스트 발송 input/button
- 행사별 notification policy radio
- 이벤트별 발송 checkbox group
- 발송 가능 여부 preview
- 알림 로그 retry 버튼

문제:

- radio/checkbox가 native 그대로 많아 시각적으로 약하다.
- 전역 설정과 행사별 설정의 관계를 사용자가 한눈에 이해하기 어렵다.
- 이벤트별 발송 on/off는 ToggleGroup이 더 적합하다.
- 로그는 테이블화, 필터, 실패 우선 보기 필요성이 높다.

개편 방향:

- `SettingsSection`, `RadioCardGroup`, `SwitchGroup` 도입
- 전역 게이트 상태는 `StatusBanner`로 상단 고정
- 알림 로그는 `DataTable` + 상태/채널/실패 필터로 전환

### 6.7 운영자 관리/권한

위치:

- `OperatorListView`
- `OperatorTable`
- `OperatorFormModal`
- `OperatorPermissionModal`
- `EventOperatorAssignModal`
- `OperatorSecretModal`

기능성 UI:

- 운영자 검색
- 운영자 추가/수정 모달
- 역할 SelectField
- 비밀번호 발급 방식 SelectField
- 최고관리자 checkbox
- 활성/비활성 ConfirmModal
- 비밀번호 재설정 ConfirmModal
- 행사 권한 부여 SelectField
- 권한 회수 ConfirmModal
- 임시 비밀번호/초대 링크 복사 textarea

문제:

- 권한 부여는 운영자 기준/행사 기준 두 경로가 있어 선택 UI의 구조가 더 명확해야 한다.
- 사유 입력 textarea가 여러 권한 모달에 반복된다.
- secret 표시 모달은 민감 정보라 시각적 경고, 복사 완료 피드백, 재표시 불가 안내가 더 강해야 한다.

개편 방향:

- `PermissionGrantPanel` 공통화
- `ReasonField` 공통화
- `SecretRevealModal` 공통화
- 권한 등급은 `PermissionBadge` + 설명 tooltip/card 사용

### 6.8 스타트업 예약

위치:

- `StartupPortalView`
- `MyBookingList`
- `BookingSlotsGrid`
- `ChangeBookingModal`
- `SatisfactionPanel`
- `ExpertSatisfactionPanel`

기능성 UI:

- 행사 선택 칩
- 내 예약 변경/취소
- 예약 matrix/time 보기 전환
- 슬롯 클릭 예약
- 예약 변경 모달
- 예약/취소 ConfirmModal
- 행사 만족도/전문가 만족도 입력

문제:

- 모바일 사용성이 핵심인데 matrix 기본 구조는 가로 스크롤 의존도가 높다.
- 전문가별 보기와 시간대별 보기의 목적 차이가 UI에서 충분히 분리되지 않는다.
- 예약 가능/마감/내 예약/신청 불가 상태가 색과 텍스트로 표현되지만, 버튼 상태와 안내 체계가 더 명확해야 한다.

개편 방향:

- 모바일 기본은 시간대별 보기, 데스크톱은 matrix도 제공
- 전문가별 보기는 전문가 프로필 카드 중심으로 재구성
- 예약 상태는 공통 `SlotStatusBadge` 또는 `SlotButton`으로 통합
- 예약 변경 모달은 현재 예약과 변경 대상 비교를 상단에 고정

### 6.9 전문가 대시보드

위치:

- `ExpertDashboardView`
- `ActiveSessionCard`
- `ExpertAttendanceControl`
- `CounselingLogModal`
- `ExpertScheduleList`

기능성 UI:

- 행사 선택 칩
- 현재/다음 상담 카드
- 사업소개서 보기
- 본인/스타트업 출석 세그먼트
- 상담 시작 버튼
- 상담일지 작성/수정 모달
- 상담일지 rating/options/text 입력
- 후속 필요 Toggle

문제:

- 현장 실사용 화면이므로 큰 터치 영역과 현재 액션 우선순위가 중요하다.
- 출석 세그먼트가 관리자 진행 화면과 유사하지만 별도 구현이다.
- 상담일지 모달은 정보량이 많아 모바일에서 단계/저장 상태가 중요하다.

개편 방향:

- `CurrentTaskCard` 도입: 지금 해야 할 일 1개를 최상단 강조
- 출석 세그먼트는 `AttendanceSegmentedControl`로 공통화
- 상담일지는 draft saved 상태, 필수 누락, 제출 완료 상태를 명확히 표시

### 6.10 현장 사진

위치:

- `StaffPhotosView`
- `CompanyPhotoList`
- `CompanyPhotoUploadPanel`
- `PhotoStatusPanel`

기능성 UI:

- 행사 SelectField
- 기업 검색
- 기업 선택 리스트
- 사진 촬영 file input
- 갤러리 선택 file input
- pending preview
- 업로드
- 사진 삭제 ConfirmModal

문제:

- 현장 화면은 모바일 우선이어야 하며 현재 카드/리스트 구조는 기본은 좋지만 더 터치 친화적으로 정리할 수 있다.
- 촬영/갤러리 버튼은 아이콘과 큰 버튼이 필요하다.
- 업로드 제한, 남은 장수, 실패 파일 정보가 더 명확해야 한다.

개편 방향:

- `PhotoPicker` 공통화
- 기업 리스트는 업로드 상태 배지와 최근 업로드 시간을 강조
- 업로드 버튼은 sticky bottom action으로 검토
- 삭제 버튼은 이미지 위 아이콘 버튼으로 통일

## 7. 반복되는 문제

### 7.1 직접 구현된 탭/칩이 많다

행사 상태 필터, 행사 상세 탭, 스타트업 행사 선택, 전문가 행사 선택, 예약 보기 전환, 만족도 리포트 역할 전환, 참가자 지정 역할 전환이 모두 유사한 버튼 UI로 직접 구현되어 있다.

결론:

- `Tabs`, `SegmentedControl`, `FilterChips`를 역할별로 분리해야 한다.
- 선택 UI의 radius, border, active color, disabled 상태를 공통화해야 한다.

### 7.2 상태 색이 직접 Tailwind 색에 의존한다

`emerald`, `blue`, `violet`, `orange`, `red`, `gray` 계열이 페이지별로 직접 사용된다.

결론:

- `success`, `info`, `warning`, `danger`, `ai`, `neutral` tone을 토큰화한다.
- 모든 Badge, Alert, Slot, Attendance, Notification 상태는 tone map을 통해 렌더링한다.

### 7.3 드롭다운이 단순 select로 해결하기 어려운 곳이 있다

강제 배정, 권한 부여, 운영자 배정, 후보 참가자 선택은 옵션 수가 늘어날 가능성이 있다.

결론:

- 단순 select, inline select, searchable select, multi select를 분리한다.
- 긴 목록은 검색 가능한 선택 UI로 전환한다.

### 7.4 테이블과 카드의 기준이 섞여 있다

운영자/관리자용 목록인데 카드 그리드인 곳도 있고, 테이블이 직접 구현된 곳도 있다.

결론:

- 백오피스 대량 데이터는 `DataTable` 기본
- 현장/참가자 모바일 조작은 카드/리스트 기본
- 같은 데이터를 desktop table + mobile card로 제공하는 패턴을 정의한다.

### 7.5 모달이 많아질수록 설정 흐름이 복잡하다

행사 상세는 설정 모달이 여러 개이고, 권한/비밀/사유/삭제 모달도 많다.

결론:

- modal footer, size, description, danger action 규칙을 정한다.
- 설정 모달은 `SettingsModal` 패턴으로 묶는다.
- 사유 입력은 `ReasonConfirmModal`로 분리한다.

## 8. 공통 컴포넌트 추가/개편 제안

### 8.1 즉시 필요한 공통 컴포넌트

| 컴포넌트 | 목적 | 적용 대상 |
| :--- | :--- | :--- |
| `Badge` | 상태/권한/파일/세션/알림 표시 | 전 화면 |
| `Tabs` | 페이지/상세 영역 전환 | 로그인, 행사 상세, 리포트 |
| `SegmentedControl` | 작은 선택 전환 | 예약 보기, 역할 전환, 출석 |
| `InlineSelect` | 테이블 행 안 작은 select | 기본 테이블, proposal 이동 |
| `SearchableSelect` | 긴 옵션 선택 | 강제 배정, 권한 배정, 운영자 선택 |
| `MultiSelectChips` | 칩 기반 다중 선택 | 분야, 후보 추가, 객관식 |
| `PageHeader` | 제목/설명/주요 액션 통일 | 모든 view |
| `PageToolbar` | 검색/필터/액션 통일 | 목록형 화면 |
| `RowActionGroup` | 테이블 행 액션 통일 | 참가자/운영자/슬롯 |
| `ActionMenu` | 행 액션이 많을 때 접기 | 참가자 DB, 운영자, 행사 목록 |
| `FileUploadField` | 파일 업로드/보기/삭제 | IR/프로필/CSV |
| `PhotoPicker` | 촬영/갤러리/미리보기 | 현장 사진 |
| `EmptyState` | 빈 목록/권한 없음/검색 결과 없음 | 전 화면 |
| `StatCard` | 요약 지표 | 운영자, 예약, 사진, 배정 |

### 8.2 컴포넌트 계층 제안

기초:

- `Button`
- `IconButton`
- `Badge`
- `Input`
- `SelectField`
- `Checkbox`
- `RadioGroup`
- `Toggle`

복합:

- `Tabs`
- `SegmentedControl`
- `SearchableSelect`
- `MultiSelectChips`
- `Modal`
- `ConfirmModal`
- `ReasonConfirmModal`
- `DataTable`
- `Pagination`

도메인:

- `EventStatusBadge`
- `PermissionBadge`
- `SlotStatusBadge`
- `AttendanceSegmentedControl`
- `NotificationGateBadge`
- `ParticipantFileStatus`
- `PhotoStatusBadge`

## 9. 우선순위

### P0: 디자인 시스템 기반

- 색상 tone 토큰 정리
- `Button` variant/size 확장
- `Badge` 도입
- `Tabs`/`SegmentedControl` 도입
- `SelectField` 정리 및 `InlineSelect` 추가
- `PageHeader`/`PageToolbar` 도입

### P1: 목록형 관리자 화면 정리

- 행사 목록을 table/mobile card 기준으로 재설계
- 참가자 DB는 기존 `DataTable` 기준을 확장
- 운영자 목록, 알림 로그, 상담/만족도 결과를 `DataTable`로 통일
- row action을 `RowActionGroup`/`ActionMenu`로 통합

### P2: 행사 상세 UX 재구성

- 상세 탭을 공통 `Tabs`로 전환
- 결과 탭과 설정 모달 패턴 통일
- 참가자 지정 목록, 진행 현황, 사진, 알림 로그의 필터/검색/테이블 기준 통일
- 운영자 배정/권한 UI의 select 검색성 개선

### P3: 현장/참가자 모바일 UX

- 스타트업 예약 기본 보기를 모바일 시간대 중심으로 개선
- 전문가 현재 상담 카드와 상담일지 작성 흐름 개선
- 현장 사진 업로드를 `PhotoPicker` 중심으로 개선
- 출석 세그먼트 통합

### P4: 고급 선택 UI

- `SearchableSelect`
- `SearchableMultiSelect`
- 권한/운영자/참가자 선택 picker
- column visibility / bulk action

## 10. 개편 원칙

1. 데이터 구조는 변경하지 않는다.
2. 공통 UI부터 바꾸고 페이지는 점진 적용한다.
3. 백오피스 대량 데이터는 테이블 중심으로 둔다.
4. 현장/참가자 화면은 모바일 터치 조작을 우선한다.
5. 같은 의미의 상태는 같은 tone과 badge로 표현한다.
6. 드롭다운은 옵션 수와 맥락에 따라 native select, inline select, searchable select를 구분한다.
7. 모달은 설정/확인/상세/민감정보 표시 용도를 분리한다.
8. 모든 기능성 UI는 loading, disabled, empty, error, success 상태를 가진다.
9. 직접 Tailwind 조합을 줄이고 공통 컴포넌트 API로 의도를 표현한다.
10. 접근성 속성은 탭, 세그먼트, 모달, row action, 파일 입력에서 기본 제공한다.

## 11. 결론

드롭다운만 독립적으로 손보는 것보다 선택 UI 전체 체계를 먼저 정리하는 것이 맞다. 현재 서비스의 기능성 UI는 대부분 구현되어 있으나, 같은 성격의 조작이 페이지마다 조금씩 다르게 구현되어 있다. 전면 UI/UX 개편의 1순위는 색상이나 카드 디자인보다 `Button`, `Badge`, `Tabs`, `SegmentedControl`, `Select`, `DataTable`, `Modal`의 공통 규칙을 확정하는 것이다.

그 다음 행사 상세, 참가자 DB, 스타트업 예약, 전문가 대시보드, 현장 사진 화면에 순차 적용하면 데이터 구조를 건드리지 않고도 전체 사용감이 크게 개선된다.
