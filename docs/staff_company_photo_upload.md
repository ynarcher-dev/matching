# 현장담당자 기업별 사진 업로드 기획

> 작성일: 2026-06-26  
> 상태: **구현 완료(2026-06-26, 마이그레이션 `0036`; 사진첩 선택 UX 후속 반영 완료).** §8 미결정 확정 — 대상=행사 참가 STARTUP 기업(event_id+company_user_id, 행사별 누적) / 업로드 범위=행사 전체 기업(담당 구역 제한 없음) / 삭제=soft delete + 스토리지 객체 제거 / 엑셀 포함=보류.
> 구현체: `company_photos` 테이블 + `event-photos` 버킷 + RLS(0036) / `/staff/photos` `StaffPhotosView` + `CompanyPhotoList`·`CompanyPhotoUploadPanel` / 관리자 행사상세 `사진 현황` 탭 `PhotoStatusPanel` / `lib/companyPhoto`·`hooks/useCompanyPhotos`.
> 사진 입력 UX: `사진 촬영`은 `capture="environment"` 카메라 input, `앨범에서 선택`은 `capture` 없는 `multiple` input으로 분리 완료. ⚠ 모바일 실기기 라운드트립과 컴포넌트 속성 테스트는 별도 검증 권장.

## 1. 목표

현장담당자가 휴대폰으로 로그인해 기업별 사진을 여러 장 촬영하고 업로드할 수 있게 한다.

핵심 요구:

- 기업별로 사진이 반드시 남아야 한다.
- 현장담당자는 모바일 웹에서 빠르게 기업을 찾고 사진을 올릴 수 있어야 한다.
- 네이티브 앱 없이 브라우저에서 휴대폰 카메라를 호출한다.
- 사진은 여러 장 업로드할 수 있어야 한다.
- 관리자는 기업별 사진 등록 여부와 누락 기업을 확인할 수 있어야 한다.

## 2. 권장 페이지 구조

업로드 위치:

```text
/staff/photos
```

현장담당자 전용 모바일 페이지로 둔다. 관리자 페이지는 검수와 조회에 집중한다.

역할 분리:

| 역할 | 기능 |
|---|---|
| 현장담당자 | 기업 검색, 사진 촬영/추가, 업로드, 본인 업로드 확인 |
| 관리자 | 기업별 사진 조회, 누락 기업 확인, 잘못된 사진 삭제/관리 |

관리자 검수 위치:

```text
/admin/events/:eventId
```

행사 상세에 `사진 현황` 탭 또는 카드로 추가한다.

## 3. 모바일 카메라 방식

1차 구현은 파일 입력 기반 네이티브 카메라 호출을 권장한다.

```html
<input type="file" accept="image/*" capture="environment">
```

이 방식은 모바일 브라우저가 OS의 카메라/사진 선택 UI를 열고, 촬영 결과를 파일로 웹앱에 전달한다.

구현은 입력을 명시적으로 분리한다.

```html
<!-- 사진 촬영: 후면 카메라 우선 -->
<input type="file" accept="image/*" capture="environment">

<!-- 앨범에서 선택: capture 없음, 여러 장 선택 허용 -->
<input type="file" accept="image/*" multiple>
```

권장 UX:

```text
1. 현장담당자 로그인
2. 행사 선택
3. 기업/참가자 검색
4. 기업 상세 카드 진입
5. [사진 찍기] 또는 [앨범에서 선택]
6. 촬영/선택한 사진을 미리보기 목록에 추가
7. 여러 장을 한 번에 업로드
8. 업로드 완료 후 기업별 사진 개수 표시
```

브라우저별로 `multiple`과 `capture`의 동작이 다를 수 있으므로, 한 번에 여러 장 촬영을 강제하기보다 "한 장씩 추가 후 여러 장 일괄 업로드" UX를 우선한다.

### 3.1 사진첩 선택 구현 체크리스트

- [x] `CompanyPhotoUploadPanel`에 숨김 input을 2개 둔다.
  - `cameraRef`: `accept="image/*"`, `capture="environment"`
  - `galleryRef`: `accept="image/*"`, `multiple`, `capture` 없음
- [x] 버튼도 2개로 나눈다.
  - `사진 촬영`
  - `앨범에서 선택`
- [x] 두 input의 `onChange`는 기존 `onPick(files)`를 공유한다.
- [x] 같은 파일을 다시 고를 수 있도록 선택 후 `input.value = ''` 초기화를 두 ref 모두에 적용한다.
- [x] 문구에서 `사진 추가 (촬영/선택)`처럼 모호한 표현을 제거한다.
- [ ] 모바일 실기기에서 아래 조합을 확인한다.
  - iOS Safari: 촬영 버튼은 카메라, 앨범 버튼은 사진 보관함/파일 선택 UI
  - Android Chrome: 촬영 버튼은 카메라, 앨범 버튼은 갤러리/파일 선택 UI
  - 앨범에서 여러 장 선택 후 미리보기 개수와 일괄 업로드 결과
- [ ] 가능하면 컴포넌트 테스트에서 `사진 촬영`/`앨범에서 선택` 버튼과 두 input 속성을 검증한다.

## 4. 데이터 모델 초안

예상 테이블:

```text
company_photos
- id
- event_id
- company_user_id 또는 startup_id
- uploaded_by
- storage_path
- original_file_name
- content_type
- file_size
- taken_at nullable
- created_at
- deleted_at nullable
```

Storage bucket:

```text
event-photos
```

권한:

- 현장담당자/관리자만 업로드 가능
- 현장담당자는 본인이 접근 가능한 행사 기업에만 업로드 가능
- 관리자는 행사별 전체 사진 조회/삭제 가능
- 일반 참가자는 다른 기업 사진을 볼 수 없음

## 5. 업로드 정책

권장 정책:

- 업로드 전 클라이언트 이미지 압축/리사이즈
- 파일당 최대 용량 제한
- 기업당 최대 사진 수 제한 검토
- 업로드 중 진행률 표시
- 실패한 파일만 재시도 가능
- 중복 업로드 방지를 위해 업로드 완료 후 목록 갱신

## 6. 관리자 현황 지표

행사 상세에서 다음 지표를 제공한다.

```text
사진 등록 현황
- 전체 기업 수
- 사진 있음
- 사진 없음
- 기업별 사진 개수
- 마지막 업로드 시각
```

누락 기업 목록에서 현장담당자가 바로 검색할 수 있는 이름/기업명을 제공한다.

## 7. 비용 관점

외부 API 비용은 없다. 다만 Supabase Storage 용량과 다운로드 트래픽 비용은 발생할 수 있다.

SMS/알림톡처럼 건당 발송비가 붙는 구조는 아니지만, 사진 수와 해상도에 따라 저장소 비용이 커질 수 있으므로 리사이즈와 용량 제한이 필요하다.

## 8. 미결정 사항

- 사진 대상: `행사 참가 STARTUP 기업(event_id + company_user_id)` 기준으로 확정.
- 현장담당자 업로드 범위: 행사 전체 기업으로 확정. 담당 구역/테이블 제한 없음.
- 관리자 삭제 방식: soft delete(`deleted_at`) + 스토리지 객체 제거로 확정.
- 사진을 엑셀/결과물 내보내기에 포함할지: 보류.
- 사진첩 선택 UX: `capture` 없는 별도 앨범 input 추가 완료. 모바일 실기기 검증은 별도 권장.
