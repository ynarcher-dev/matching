# UI/UX Rework 09-B - Functional Components

## 1. 목표

드롭다운, 탭, 토글, 모달, 테이블, 업로드, 행 액션 등 기능성 UI를 공통 컴포넌트 체계로 정리한다.

## 2. 현재 문제

- `Button` variant가 `primary | outline`만 있어 액션 위험도와 위계 표현이 부족하다.
- 탭/필터칩/세그먼트가 직접 버튼으로 반복 구현되어 있다.
- `SelectField`와 직접 `<select>`가 혼재한다.
- `DataTable`은 일부 화면에만 적용되어 있다.
- 파일/사진 업로드, row action, empty state가 페이지별로 다르게 구현된다.

## 3. 작업 범위

### 3.1 기본 컴포넌트

- `Button`: variant/size/icon/loading 확장
- `IconButton`: 닫기, 삭제, 편집, 다운로드, 복사 등 아이콘 액션
- `Badge`: 상태, 권한, 파일, 알림, 예약, 출석 표시
- `EmptyState`: 빈 목록, 권한 없음, 검색 결과 없음

### 3.2 선택 UI

- `Tabs`: 페이지/상세 영역 전환
- `SegmentedControl`: 작은 상태 전환, 보기 전환, 출석 선택
- `FilterChips`: 필터 전용 칩
- `InlineSelect`: 테이블 행 안의 작은 select
- `SearchableSelect`: 긴 옵션 목록
- `MultiSelectChips`: 분야/후보/객관식 다중 선택

### 3.3 데이터/액션 UI

- `DataTable`: density, row action, mobile fallback 확장
- `PageToolbar`: 검색, 필터, 우측 액션
- `RowActionGroup`: 행 액션 나열
- `ActionMenu`: 액션이 많을 때 접기
- `FileUploadField`: 파일 선택, 보기, 삭제
- `PhotoPicker`: 촬영, 갤러리 선택, 미리보기

## 4. 드롭다운 분류 원칙

- 옵션이 적고 설명이 필요 없으면 `SelectField`
- 테이블 행 안에서는 `InlineSelect`
- 후보/운영자/스타트업처럼 목록이 길면 `SearchableSelect`
- 여러 항목을 선택하면 `MultiSelectChips` 또는 `SearchableMultiSelect`

## 5. 완료 기준

- 직접 `<select>` 사용 지점을 의도별 컴포넌트로 대체할 계획이 확정된다.
- 직접 구현된 탭/칩이 `Tabs`, `SegmentedControl`, `FilterChips`로 분류된다.
- row action과 danger action이 공통 스타일을 사용한다.
- 모든 기능성 UI가 loading, disabled, empty, error 상태를 갖는다.
