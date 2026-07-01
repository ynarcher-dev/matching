# 개발 현황 및 마일스톤 체크리스트

이 문서는 현재 코드베이스를 기준으로 구현 상태를 역추적해 정리한 최신 개발 현황입니다.
세부 설계와 작업 이력은 각 기획 문서와 `worklog_*.md` 문서를 원본으로 삼고, 이 문서는 빠른 상태 파악용 허브로 유지합니다.

## 전체 진행률

`[#######################-] 96%`

2026-07-01 기준, 핵심 행사 매칭 운영 흐름은 대부분 구현되어 있습니다. 남은 작업은 외부 알림 API 실연동, 일부 실기기/실계정 라운드트립 검증, 운영 편의성 보강 중심입니다.

## 현재 구현 스냅샷

- Frontend: Vite + React + TypeScript + Tailwind CSS v4
- Backend: Supabase DB/RLS/RPC/Storage/Edge Functions
- 인증: 운영자 Supabase Auth, 참가자 이름+휴대전화 기반 무료 로그인, 긴급 1회용 로그인 링크
- DB 마이그레이션: `0001_schema.sql`부터 `0068_proposal_file_name.sql`까지 존재
- 주요 화면: 관리자 행사/참가자/운영자/알림, 스타트업 예약 포털, 전문가 상담 대시보드, 현장 사진 업로드
- 검증 체계: `lint`, `typecheck`, `build`, `vitest`, 운영자 권한 자동 검증 스크립트 보유

## 개발 진행 순서 규칙

작업 시작 전 관련 문서를 먼저 확인합니다.

- DB/RLS/RPC 변경: [db_schema.md](./db_schema.md), [security_transactions.md](./security_transactions.md)
- 인증/레이아웃 변경: [page_auth_layout.md](./page_auth_layout.md)
- 관리자 행사 목록: [page_admin_event_list.md](./page_admin_event_list.md)
- 관리자 행사 상세: [page_admin_event_detail.md](./page_admin_event_detail.md)
- AI 자동 배치: [page_admin_ai_allocation.md](./page_admin_ai_allocation.md)
- 참가자 DB: [page_admin_user_management.md](./page_admin_user_management.md)
- 스타트업 예약: [page_startup_booking.md](./page_startup_booking.md)
- 전문가 대시보드: [page_expert_dashboard.md](./page_expert_dashboard.md), [expert_dashboard_split_view_ideation.md](./expert_dashboard_split_view_ideation.md)
- 운영자/행사별 권한: [page_admin_operator_permissions.md](./page_admin_operator_permissions.md)
- 알림: [event_notification_api_plan.md](./event_notification_api_plan.md), [page_admin_notification_settings.md](./page_admin_notification_settings.md)
- UI/UX: [uiux_rework_09_overview.md](./uiux_rework_09_overview.md), [uiux_responsive_review.md](./uiux_responsive_review.md)

## 단계별 구현 현황

### [x] Phase 1. 기획 문서와 개발 기반

- [x] 개발 개요/DB/보안/권한/거래 정책 문서 작성
- [x] 페이지별 주요 명세 작성
- [x] 기능 보강, UI/UX, 운영자 권한, 알림, 설문/상담일지 관련 후속 기획 문서 작성

### [x] Phase 2. Supabase DB/RLS/RPC 기반

- [x] 핵심 테이블, 인덱스, RLS, Storage 정책 작성
- [x] 예약/변경/취소/강제 배정/상담 진행/출석/감사 로그 RPC 작성
- [x] 행사 상태 전환, 슬롯 생성, AI 배치, 참가자 인증, 알림 큐, 설문/상담일지, 운영자 권한, Storage 범위 정책 반영
- [x] 마이그레이션 `0001`~`0068`까지 누적
- [x] OTP 인증 산출물은 무료 로그인 전환 후 `0060`에서 정리

### [x] Phase 3. 인증과 공통 레이아웃

- [x] 운영자 로그인: Supabase Auth + `users.auth_user_id` 프로필 검증
- [x] 참가자 로그인: 이름+휴대전화 정확 매칭 방식으로 전환
- [x] 참가자 커스텀 JWT, 세션 버전, 세션 무효화 흐름 유지
- [x] 긴급 1회용 로그인 링크: 관리자 발급, `/login/emergency` 소비
- [x] `authStore`, `RequireAuth`, `RequireRole`, `RequireSuperAdmin`, 역할별 홈/내비게이션 구성
- [x] `AppShell`, `Header`, `Sidebar`, 모바일 내비게이션, 데스크톱 접기/펼치기 구현

### [x] Phase 4. 관리자 백오피스

- [x] 행사 목록/생성/수정/취소
- [x] 행사 상세: 참가 스타트업/전문가 배정, 테이블 관리, 슬롯 생성, 예약 현황, 진행 관리, 운영 관리, 결과/설정 모달
- [x] 참가자 DB: 스타트업/전문가 분리, 검색/필터, 개별 추가/수정, CSV 일괄 업로드, 분야/파일/프로필 관리
- [x] 관리자 행사 권한: OWNER/MANAGER/STAFF/VIEWER 모델, 일반 운영자의 행사 범위 RLS/RPC 제한
- [x] 운영자 계정 관리: 생성/수정/비활성화/재활성화/비밀번호 재설정/행사 권한 부여/회수
- [x] 결과 엑셀 내보내기: 예약, 출석, 상담 결과, 만족도, 참가자 명단 시트
- [x] 전역 알림 설정과 행사별 알림 설정/로그 화면
- [x] 행사 알림 탭은 전역 임시 토글(`event_notification_tab_enabled`)로 노출 제어

### [x] Phase 5. 스타트업 예약 포털

- [x] 참여 행사 목록과 행사별 예약 현황
- [x] 전문가/시간대 기반 예약, 변경, 취소
- [x] 예약 기간 이후에도 행사 설정에 따라 ALLOCATION/PROGRESS 단계의 자기 예약 변경 허용
- [x] 전문가 프로필/분야/가능 시간 표시
- [x] 상담 요청사항(`counseling_request`) 작성
- [x] 회사 홈페이지/참고 URL 저장
- [x] 사업소개서 업로드, 업로드 이력, 원본 파일명 동기화
- [x] 행사 종료 후 행사 만족도, 전문가 만족도, 공개 코멘트 확인

### [x] Phase 6. 전문가 대시보드

- [x] 전문가 참여 행사와 전체 상담 일정 표시
- [x] 상담 선택 시 Split View 워크스페이스 제공
- [x] 좌측: 스타트업 정보, 회사 소개, 자료/링크, 상담 요청사항
- [x] 우측: 상담 시작, 상담일지 작성/저장/제출
- [x] 상담 시작 시 전문가/스타트업 자동 출석 처리
- [x] 상담 완료 시 동적 상담일지 답변 저장, 공개 코멘트/결과 리포트 연동
- [x] 이전 상담 이력 화면

### [x] Phase 7. 후속 운영 기능

- [x] 무료 로그인 전환: OTP 요청/검증 UI 제거, 이름+휴대전화 로그인 적용
- [x] 현장 담당자 회사별 사진 업로드: 촬영/앨범 선택, 리사이즈, Storage 업로드, 관리자 현황 확인
- [x] 알림 인프라: `notification_logs`, 큐/재시도/백오프, `notification-dispatch` Edge, Mock notifier
- [x] 알림 설정: 전역/행사별 채널 정책, 발송 게이트
- [x] 설문 커스터마이징: 행사 만족도, 전문가 만족도, 질문 빌더, 결과 리포트, CSV/엑셀 연동
- [x] 상담일지 커스터마이징: 질문 빌더, 동적 답변, 결과 리포트, CSV/엑셀 연동
- [x] 운영자 권한 모델과 자동 검증 스크립트
- [x] 진행 상태와 출석 통합: IN_PROGRESS/COMPLETED는 자동 PRESENT, WAITING은 미정 복귀, NO_SHOW는 스타트업 ABSENT
- [x] 노쇼 대체 매칭: NO_SHOW 슬롯에 현장 대기 스타트업 재배정
- [x] 테이블 담당자 지정: `event_tables.manager_user_id`, `set_table_manager`
- [x] Storage owner 추출 오류 수정과 제안서 파일명 표시 개선

### [~] Phase 8. UI/UX 정비와 반응형 검증

- [x] 디자인 토큰, tone map, 공통 `Badge`, `Tabs`, `SegmentedControl`, `PageToolbar`, `DataTable`, `PhotoPicker`, `ResizableSplit` 등 정비
- [x] 관리자 목록/상세/예약/진행/전문가/스타트업/현장 UX의 공통 컴포넌트 적용
- [x] 전문가 Split View와 상담 워크스페이스 적용
- [ ] 360px, 768px, 1024px, 1440px 주요 뷰포트 실브라우저 수동 검증
- [ ] 모바일 실기기 카메라/앨범 업로드, split view 터치 조작, 긴 테이블 가로 스크롤 재확인

## 남은 작업

### 높은 우선순위

- [ ] 외부 알림 API(Solapi/카카오 알림톡/SMS) 실제 어댑터 연동
- [ ] 알림 Cron 자동화용 Vault 값/pg_net 운영 설정 최종 반영
- [ ] 알림 트리거 라운드트립 검증: 예약/변경/취소/행사 오픈 -> 큐 적재 -> dispatch -> SENT/FAILED
- [ ] 참가자/운영자 실제 계정 기준 주요 경로 E2E 재검증
- [ ] 모바일 실기기 검증: 현장 사진 업로드, 스타트업 예약, 전문가 상담 시작/일지 제출

### 보통 우선순위

- [ ] QR 서명 체크인 기능은 보류 상태 유지 또는 재기획
- [ ] `users`/`fields`/`user_fields` 등 전역 디렉터리성 RLS를 행사 범위로 더 좁힐지 재검토
- [ ] 감사 로그 관리자 화면 표시
- [ ] 상담/만족도 결과 PDF 출력 여부 결정
- [ ] 운영자 권한 변경 이력/알림 UX 보강

## 최근 주요 변경 기록

- `0035`: 참가자 이름+휴대전화 무료 로그인 전환
- `0036`: 현장 회사 사진 업로드
- `0037`~`0038`: 알림 설정/발송 게이트
- `0039`~`0045`: 운영자 계정과 행사별 권한, 행사 범위 RLS/RPC/Storage 제한
- `0046`~`0049`: 로그인/업로드 추적, 만족도 정책, 전문가 만족도, 스타트업 자체 제안서 업로드
- `0050`~`0051`: 관리자/전문가 상담 시작과 진행 상태 제어
- `0052`: 제안서 업로드 이력
- `0055`~`0059`: 참가자 제거/오프닝 슬롯 정리 정책
- `0060`: OTP 인증 산출물 정리
- `0061`: 전문가의 행사 만족도 작성 제거, 스타트업 중심 행사 만족도 정리
- `0062`: 진행 상태 기반 출석 자동 동기화
- `0063`: 노쇼 대체 매칭
- `0064`: 테이블 담당자 지정
- `0065`: 행사 알림 탭 전역 토글
- `0066`: 전문가 Split View 요청사항/홈페이지/상담 시작 자동 출석
- `0067`: Storage owner id 추출 수정
- `0068`: 제안서 원본 파일명 동기화

## 유지보수 체크리스트

- [ ] 변경 시 `development_status.md`와 관련 기획/작업 문서 동기화
- [ ] DB 변경 시 마이그레이션 번호 순서와 RLS/RPC 권한 회귀 검증
- [ ] 공통 UI 변경 시 관리자/스타트업/전문가/현장 화면을 함께 확인
- [ ] 인증/권한 변경 시 운영자 권한 자동 검증 스크립트와 참가자 JWT 경로 확인
- [ ] 새 기능 추가 시 `lint`, `typecheck`, `build`, `test` 실행 결과 기록
