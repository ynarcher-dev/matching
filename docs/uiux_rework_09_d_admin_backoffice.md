# UI/UX Rework 09-D - Admin Backoffice Lists

## 1. 목표

관리자 백오피스 목록 화면을 테이블, 검색, 필터, 정렬, 페이지네이션, 행 액션 중심으로 정리한다.

## 2. 대상 화면

- 행사 목록: `EventListView`
- 스타트업 DB / 전문가 DB: `ParticipantDbView`
- 운영자 관리: `OperatorListView`
- 알림 로그: `NotificationLogPanel`
- 상담일지 결과: `CounselingReportPanel`
- 사진 상태: `PhotoStatusPanel`
- 참가자 지정 현재 목록: `ParticipantAssignPanel`

## 3. 현재 문제

- 행사 목록은 카드 그리드 중심이라 데이터가 많을 때 스캔 효율이 낮다.
- 운영자 목록과 일부 로그/결과 화면은 직접 table/list 구현이 남아 있다.
- 검색/필터/페이지네이션 적용 수준이 화면마다 다르다.
- row action이 작은 텍스트 버튼 나열로 복잡해질 수 있다.

## 4. 작업 범위

- `DataTable` 적용 대상 확대
- `PageToolbar`로 검색/필터/액션 정리
- `Pagination` 기본 page size 30 유지
- `RowActionGroup` 또는 `ActionMenu` 도입
- desktop table + mobile card fallback 기준 정의

## 5. 화면별 방향

행사 목록:

- desktop 기본은 테이블
- 카드 보기는 선택 모드로 유지 가능
- 상태, 기간, 권한, 참가자 수, 액션 컬럼 제공

참가자 DB:

- 기존 구조 유지하되 badge와 row action 정리
- 파일/로그인/진단 상태를 빠르게 스캔 가능하게 개선

운영자 관리:

- summary card는 유지
- 목록은 `DataTable` 또는 같은 규칙의 테이블로 정리
- 권한 배정/비밀번호 재설정/활성 상태 액션을 action group으로 묶음

알림 로그:

- 상태, 유형, 채널, 대상, 시각, 재시도 액션 컬럼화
- 실패 우선 필터 제공

## 6. 완료 기준

- 관리자 목록 화면이 같은 검색/필터/테이블 규칙을 공유한다.
- 모바일에서 테이블 가로 스크롤만 강제하지 않고 핵심 정보 card fallback을 제공한다.
- 행 액션이 일관된 버튼/메뉴로 보인다.
