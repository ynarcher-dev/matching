# 전문가 대시보드 Split View 상담 워크스페이스

이 문서는 전문가가 상담 대상 기업 자료를 보면서 상담일지를 작성할 수 있도록 구현된 Split View 기반 상담 워크스페이스를 정리합니다.

## 1. 목적

기존 상담 흐름은 기업 자료 확인과 상담일지 작성이 분리되어 있어, 전문가가 PDF/링크를 열람한 뒤 다시 입력 화면으로 돌아와야 했습니다.

현재 구현은 상담 일정에서 기업을 선택하면 같은 화면 안에서 다음 작업을 동시에 수행하도록 구성합니다.

- 전체 상담 일정 확인
- 기업 자료와 요청사항 열람
- 상담 시작 처리
- 상담일지 임시저장과 최종 제출
- 제출 완료 후 재편집을 위한 제출 취소

## 2. 구현 파일

- View: `src/views/expert/ExpertDashboardView.tsx`
- Workspace: `src/components/expert/ExpertCounselingWorkspace.tsx`
- 일정 테이블: `src/components/expert/ExpertScheduleTable.tsx`
- 기업 정보 패널: `src/components/expert/CompanyInfoPanel.tsx`
- 상담일지 폼: `src/components/expert/CounselingLogForm.tsx`
- Split 컴포넌트: `src/components/common/ResizableSplit.tsx`
- 데이터 훅: `src/hooks/useExpertPortal.ts`
- 상담일지 유틸: `src/lib/counseling.ts`
- 시간/활성 슬롯 유틸: `src/lib/expertSchedule.ts`
- 제출 취소 RPC: `supabase/migrations/0075_reopen_counseling_log.sql`

## 3. 화면 흐름

### 3.1 기본 일정 화면

전문가가 `/expert/dashboard`에 진입하면 참여 가능한 행사 목록 중 진행 중인 행사 또는 첫 번째 행사를 선택해 상담 일정을 보여줍니다.

- 행사 상태가 `PROGRESS`가 아니면 일정과 기업 자료만 확인할 수 있습니다.
- `PROGRESS` 상태에서만 상담 시작과 상담일지 제출이 가능합니다.
- 일정은 본인 전문가 ID에 배정된 `matching_slots`만 조회합니다.
- 현재 시간 기준 활성 슬롯을 계산해 강조합니다.

### 3.2 Split View 진입

일정에서 상담 슬롯을 열면 `ExpertCounselingWorkspace`로 전환됩니다.

상단에는 다음 정보가 표시됩니다.

- 전체 일정으로 돌아가기
- 기업명 또는 참가자명
- 대표자명
- 상담 시간

본문은 `ResizableSplit`으로 구성됩니다.

- 좌측: `CompanyInfoPanel`
- 우측: `CounselingLogForm` 또는 상담 시작 안내

## 4. 좌측 기업 정보 패널

기업 정보 패널은 두 개의 탭으로 구성됩니다.

### 4.1 소개서/IR 탭

- `users.proposal_file_url`을 기반으로 Storage signed URL을 발급합니다.
- 원본 파일명은 `users.proposal_file_name`을 사용합니다.
- PDF는 iframe으로 내장 표시합니다.
- 브라우저 내장 PDF 렌더링이 불안정한 환경을 위해 새 창/다운로드 링크를 함께 제공합니다.
- 새 자료가 업로드된 경우 최신 signed URL을 다시 발급할 수 있도록 새로고침 버튼을 제공합니다.

### 4.2 링크 및 요청 탭

다음 정보를 한 패널에서 보여줍니다.

- 회사 설명: `users.company_description`
- 상담 요청사항: `matching_slots.counseling_request`
- 참고 URL 목록: `company_links`

참고 URL은 `0073_company_links.sql`과 `0074_company_links_coparticipant_read.sql` 기준으로 구현되어 있습니다.

- 스타트업은 URL과 부가 설명을 여러 개 등록할 수 있습니다.
- 첫 번째 URL은 기존 `users.company_homepage`와 동기화됩니다.
- 같은 행사에 참여한 전문가는 RLS를 통해 해당 스타트업의 참고 URL을 조회할 수 있습니다.

## 5. 우측 상담일지 패널

### 5.1 상담 시작 전

슬롯의 `session_status`가 `WAITING`이면 상담 시작 안내가 표시됩니다.

- 행사 상태가 `PROGRESS`이면 상담 시작 버튼을 표시합니다.
- 상담 시작 버튼은 `start_counseling` RPC를 호출합니다.
- 상담 시작 시 슬롯은 `IN_PROGRESS`로 전환되고, 전문가/스타트업 출석이 자동 처리됩니다.

### 5.2 상담일지 작성

`IN_PROGRESS` 또는 `COMPLETED` 상태에서는 상담일지 폼을 표시합니다.

상담일지 질문은 `counseling_log_questions`에서 행사별로 조회합니다.

지원 질문 유형:

- `RATING`
- `SHORT_ANSWER`
- `LONG_ANSWER`
- `SINGLE_CHOICE`
- `MULTIPLE_CHOICE`

공통 메타 필드:

- 후속 연계 요청 여부
- 후속 연계 메모
- 공개 여부

### 5.3 임시저장

상담일지는 다음 방식으로 저장됩니다.

- 입력이 멈춘 뒤 5초가 지나면 자동 임시저장
- 폼에서 포커스가 빠져나갈 때 자동 임시저장
- 사용자가 직접 임시저장 버튼 클릭

임시저장은 `save_counseling_log_draft_v2` RPC를 호출합니다.

### 5.4 최종 제출

최종 제출 시 `validateSubmit`이 필수 질문과 길이 제한을 검증합니다.

검증 통과 후 `submit_counseling_log_v2` RPC를 호출합니다.

- 상담 답변은 `counseling_log_answers`로 저장됩니다.
- 기존 레거시 컬럼과 동적 답변을 함께 읽을 수 있도록 호환 로직을 유지합니다.
- 제출 완료 시 슬롯은 `COMPLETED` 상태가 됩니다.

### 5.5 제출 취소와 재편집

`0075_reopen_counseling_log.sql`에서 `reopen_counseling_log_v2` RPC가 추가되었습니다.

동작:

- 전문가 본인의 상담 슬롯만 취소할 수 있습니다.
- 현재 슬롯 상태가 `COMPLETED`일 때만 가능합니다.
- 행사가 `FINISHED`이면 취소할 수 없습니다.
- 작성 내용은 유지하고 `submitted_at`만 비웁니다.
- 슬롯 상태를 `IN_PROGRESS`로 되돌려 재편집과 재제출을 허용합니다.
- 감사 로그에 `REOPEN_COUNSELING_LOG`를 남깁니다.

## 6. Split View 동작

`ResizableSplit`은 다음 동작을 제공합니다.

- 데스크톱: 좌우 패널 분할
- 초기 좌측 비율: 2/3
- 최소 패널 비율: 25%
- 드래그로 좌우 비율 조절
- 더블클릭 시 50:50 초기화
- 키보드 좌/우 화살표로 5%p 단위 조절
- 드래그 중 iframe이 포인터 이벤트를 가로채지 않도록 투명 오버레이 표시
- 1024px 미만에서는 좌우 분할 대신 상하 스택으로 전환

## 7. 데이터 조회와 권한

전문가 대시보드는 참가자 전용 `participantClient`를 사용합니다.

주요 조회:

- `events`: 전문가가 참여한 행사
- `matching_slots`: 본인 전문가 ID에 배정된 슬롯
- `users`: 슬롯에 배정된 스타트업 요약 정보
- `company_links`: 같은 행사 참여자 범위의 참고 URL
- `event_tables`: 테이블 코드
- `counseling_log_questions`: 행사별 상담일지 질문
- `counseling_logs`와 `counseling_log_answers`: 본인 상담일지

권한 최종 검증은 RLS와 RPC에서 수행합니다.

## 8. 구현 완료 상태

- [x] 전체 상담 일정 화면
- [x] 일정 선택 시 Split View 전환
- [x] 기업 PDF 내장 뷰어와 다운로드 링크
- [x] 회사 정보, 상담 요청사항, 참고 URL 표시
- [x] 좌우 분할 비율 드래그 조절
- [x] 모바일/태블릿 상하 스택 전환
- [x] 상담 시작과 자동 출석 처리
- [x] 행사별 동적 상담일지 질문
- [x] 자동/수동 임시저장
- [x] 최종 제출
- [x] 제출 취소와 재편집

## 9. 남은 확인 사항

- [ ] 실제 모바일 브라우저에서 PDF iframe 동작 확인
- [ ] 360px, 768px, 1024px, 1440px 뷰포트별 레이아웃 확인
- [ ] 긴 회사명, 긴 URL, 긴 상담 요청사항에서 overflow 확인
- [ ] 상담 중 네트워크 불안정 시 자동저장 실패 메시지와 재시도 UX 확인
