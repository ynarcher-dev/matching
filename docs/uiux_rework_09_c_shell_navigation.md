# UI/UX Rework 09-C - Shell and Navigation

## 1. 목표

공통 앱 쉘, 헤더, 사이드바를 재정리한다. 특히 데스크톱 사이드바 접기 기능을 추가하고 역할/권한 기반 메뉴 표시를 더 명확하게 만든다.

## 2. 현재 구조

- `AppShell`: 좌측 Sidebar + 상단 Header + main padding
- `Sidebar`: 데스크톱 240px 고정, 모바일 slide-in
- `Header`: 모바일 메뉴 열기, 로고, 사용자명, 로그아웃
- `navItemsFor`: 역할 및 최고관리자 여부 기준 메뉴 제어

## 3. 현재 문제

- 데스크톱 사이드바 접기 기능이 없다.
- 메뉴 아이콘이 없어 접힘 상태 표현이 어렵다.
- 헤더 정보 위계가 약하다.
- 메뉴 그룹과 권한 범위 표시가 부족하다.

## 4. 작업 범위

- `uiStore`에 `sidebarCollapsed` 상태 추가
- 데스크톱 sidebar 폭: expanded 240px, collapsed 64px
- collapsed 상태에서 아이콘만 표시하고 tooltip 제공
- Header에 현재 사용자/역할/주요 상태 표시 정리
- 모바일 sidebar 기존 slide-in 유지
- 메뉴 그룹: 운영, 참가자 DB, 설정, 현장, 전문가, 스타트업

## 5. 완료 기준

- 데스크톱에서 사이드바 접기/펼치기가 가능하다.
- 모바일 메뉴 동작은 기존과 동일하게 유지된다.
- 메뉴 active 상태가 expanded/collapsed 모두에서 명확하다.
- 일반 ADMIN과 super admin의 메뉴 차이가 더 명확하다.
