# UI/UX Rework 09-G - Expert and Field Mobile

## 1. 목표

전문가 대시보드와 현장 사진 업로드 화면을 모바일 현장 사용 기준으로 개선한다. 큰 터치 영역, 현재 해야 할 일, 빠른 확인과 업로드가 핵심이다.

## 2. 대상

- `ExpertDashboardView`
- `ActiveSessionCard`
- `ExpertAttendanceControl`
- `CounselingLogModal`
- `ExpertScheduleList`
- `StaffPhotosView`
- `CompanyPhotoList`
- `CompanyPhotoUploadPanel`
- `PhotoStatusPanel`

## 3. 전문가 화면 작업

현재 문제:

- 현재 상담 카드가 중요하지만 버튼/상태/출석 UI가 더 강하게 정리될 수 있다.
- 출석 세그먼트가 관리자 진행 화면과 별도 구현이다.
- 상담일지 모달은 모바일에서 정보량이 많다.

개편 방향:

- **상단 행사 전환 탭 공통화**: `ExpertDashboardView.tsx`의 하드코딩된 다중 이벤트 선택 버튼(capsule형 `<button>`)들을 공용 `Tabs` 컴포넌트로 교체하여 상단 탭 규칙에 맞추어 일관성 확보.
- `CurrentTaskCard`: 현재/다음 상담과 가장 중요한 액션 강조
- `AttendanceSegmentedControl`: 미정/출석/불참 공통화
- 상담 시작, 상담일지 작성 버튼은 큰 터치 영역 유지
- 상담일지 저장/제출/필수 누락/완료 상태를 명확히 표시

## 4. 현장 사진 작업

현재 문제:

- 촬영/갤러리 선택은 기능상 가능하지만 버튼 위계와 업로드 상태가 더 명확해야 한다.
- pending preview, 기존 사진, 삭제 액션의 패턴이 도메인 내부에만 있다.
- 기업 리스트는 업로드 상태와 최근 시각이 더 잘 보여야 한다.

개편 방향:

- `PhotoPicker`: 촬영, 갤러리 선택, 미리보기, 제거
- 기업 리스트에 사진 있음/없음/총 사진/최근 업로드 badge 표시
- 업로드 대기 수와 남은 업로드 가능 수 표시
- 삭제는 `IconButton danger` + ConfirmModal

## 5. 완료 기준

- 전문가가 현재 해야 할 일을 첫 화면에서 바로 알 수 있다.
- 출석 컨트롤이 관리자/전문가 화면에서 같은 규칙을 공유한다.
- 현장 사진 촬영/선택/업로드 플로우가 모바일에서 명확하다.
- 사진 업로드 오류와 성공 결과가 눈에 잘 띈다.
