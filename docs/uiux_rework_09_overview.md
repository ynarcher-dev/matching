# UI/UX Rework 09 - Overview

작성일: 2026-06-28  
상태: 구현 전 단위 작업 분해 문서  
원본 분석: [UI/UX Functional UI Audit](./uiux_functional_ui_audit.md)

## 1. 목적

9번째 작업은 데이터 구조 변경 없이 서비스 전반의 UI/UX를 재정비하는 작업이다. 우선순위는 화면을 하나씩 꾸미는 것이 아니라, 기능성 UI를 공통 규칙으로 묶고 그 규칙을 주요 화면에 순차 적용하는 것이다.

## 2. 작업 원칙

- 데이터 구조는 변경하지 않는다.
- 먼저 디자인 토큰과 공통 컴포넌트를 정리한다.
- 백오피스 화면은 테이블, 필터, 행 액션 중심으로 정리한다.
- 스타트업, 전문가, 현장 화면은 모바일 터치 조작을 우선한다.
- 드롭다운은 단순 select, inline select, searchable select, multi select로 구분한다.
- 기존 기능을 제거하지 않고 같은 데이터와 액션을 더 일관된 UI로 재배치한다.

## 3. 단위 작업 목록

| ID | 문서 | 목표 |
| :--- | :--- | :--- |
| 9-A | [디자인 토큰과 시각 언어](./uiux_rework_09_a_design_tokens.md) | 색상, radius, shadow, spacing, 상태 tone 정리 |
| 9-B | [공통 기능성 컴포넌트](./uiux_rework_09_b_functional_components.md) | Button, Badge, Tabs, Select, Modal, DataTable 계층 정리 |
| 9-C | [앱 쉘과 내비게이션](./uiux_rework_09_c_shell_navigation.md) | 사이드바 접기, 헤더, 메뉴 구조, 권한 표시 정리 |
| 9-D | [관리자 백오피스 목록 화면](./uiux_rework_09_d_admin_backoffice.md) | 행사/참가자/운영자/알림 로그 목록형 UX 정리 |
| 9-E | [행사 상세 대시보드](./uiux_rework_09_e_event_detail.md) | 행사 상세 탭, 설정 모달, 결과 패널, 진행 UI 정리 |
| 9-F | [스타트업 예약 UX](./uiux_rework_09_f_startup_booking.md) | 예약 보기, 전문가 카드, 시간대 선택, 만족도 입력 개선 |
| 9-G | [전문가/현장 모바일 UX](./uiux_rework_09_g_field_mobile.md) | 전문가 현재 상담, 출석, 상담일지, 현장 사진 업로드 개선 |
| 9-H | [적용 순서와 검증](./uiux_rework_09_h_rollout_verification.md) | 단계별 적용, 회귀 확인, 반응형 검증 기준 정리 |

## 4. 권장 구현 순서

1. 9-A 디자인 토큰 확정
2. 9-B 공통 컴포넌트 확장
3. 9-C 앱 쉘/사이드바 접기
4. 9-D 관리자 목록 화면 정리
5. 9-E 행사 상세 재구성
6. 9-F 스타트업 예약 개선
7. 9-G 전문가/현장 모바일 개선
8. 9-H 검증 및 문서 업데이트

## 5. 완료 기준

- 공통 컴포넌트가 화면별 직접 조합을 대체한다.
- 동일한 상태는 동일한 badge/tone으로 보인다.
- 목록형 관리자 화면은 검색, 필터, 정렬, 페이지네이션 규칙을 공유한다.
- 모바일 핵심 화면은 가로 스크롤 의존도를 줄이고 주요 액션이 큰 터치 영역으로 제공된다.
- `npm run lint`, `npm run typecheck`, `npm run build`, 관련 테스트가 통과한다.
