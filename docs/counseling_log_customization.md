# [기능 기획] 전문가 상담일지 평가표 커스터마이징

본 문서는 전문가가 상담 종료 시 작성하는 **상담일지 평가표**를 행사별로 커스터마이즈하기 위한 기획 및 개발 전달 문서입니다. 기존 고정형 스코어카드(`기술성`, `전문성`, `신뢰도`, `협업 잠재력`, `거래 가능성`)를 스타트업/전문가 만족도 조사 커스터마이징과 유사한 동적 문항 구조로 확장하는 것이 목표입니다.

참고 문서:
- [전문가 대시보드 및 상담일지 명세](./page_expert_dashboard.md)
- [행사별 만족도 조사 커스터마이징](./page_survey_customization.md)
- [개발용 시드 데이터 컨벤션](./dev_seed_convention.md)

---

## 1. 배경과 목표

현재 상담일지 모달은 `src/lib/counseling.ts`의 `SCORECARD_ITEMS`와 `counseling_logs` 고정 컬럼에 강하게 결합되어 있습니다.

현행 고정 항목:
- `score_technology` — 기술성
- `score_expertise` — 전문성
- `score_reliability` — 신뢰도
- `score_collaboration` — 협업 잠재력
- `score_probability` — 거래 가능성
- `content` — 상담 의견
- `follow_up_required` / `follow_up_memo` — 후속 연계
- `is_public` — 상담 의견 스타트업 공개 여부

기획 의도는 행사 성격에 따라 전문가가 작성해야 하는 평가 항목을 다르게 구성할 수 있게 하는 것입니다. 예를 들어 투자상담 행사에서는 `투자 가능성`, `시장 규모`, `팀 실행력`을 묻고, 기술검증 행사에서는 `기술 완성도`, `PoC 적합성`, `특허/인증 리스크`를 물을 수 있어야 합니다.

---

## 2. 핵심 요구사항

1. **행사별 독립 구성**
   - 각 행사마다 전문가 상담일지 평가 항목을 다르게 설정할 수 있어야 합니다.
   - 행사 생성 시 기본 상담일지 템플릿이 자동 생성되어야 합니다.

2. **문항 유형 확장**
   - 1차 범위는 상담일지에 필요한 최소 유형으로 시작합니다.
   - 권장 1차 유형:
     - `RATING` — 1~5점 척도
     - `SHORT_ANSWER` — 단답 메모
     - `LONG_ANSWER` — 상담 의견/서술형
     - `SINGLE_CHOICE` — 단일 선택
     - `MULTIPLE_CHOICE` — 복수 선택

3. **상담 슬롯 단위 응답**
   - 만족도 조사는 `event_id + user_id` 기준 1회 제출이지만, 상담일지는 **상담 슬롯(`matching_slot_id`)별 1개**입니다.
   - 같은 전문가가 같은 행사에서 여러 스타트업을 상담하면 각 슬롯마다 별도 일지를 작성합니다.

4. **임시저장과 최종 제출 유지**
   - 기존 `save_counseling_draft` / `submit_counseling_log` 흐름은 유지해야 합니다.
   - 임시저장은 필수 문항 미입력 상태도 허용합니다.
   - 최종 제출은 필수 문항 검증 후 `matching_slots.session_status = 'COMPLETED'` 전환과 함께 트랜잭션으로 처리합니다.

5. **공개 범위 정책 유지**
   - 내부 평가 점수와 구조화 답변은 스타트업에 공개하지 않습니다.
   - 스타트업에는 기존처럼 전문가가 공개 허용한 텍스트 코멘트만 노출합니다.
   - 공개 코멘트는 동적 문항 중 특정 `public_comment` 용도 문항을 지정하거나, 기존 `content` 컬럼을 호환 필드로 유지하는 방식을 선택합니다.

---

## 3. 범위 결정 제안

| 항목 | 제안 |
|---|---|
| 기존 고정 컬럼 | 1차에서는 보존. 신규 동적 답변 테이블을 병행하고, 레거시 컬럼은 호환/리포트 안정성을 위해 유지 |
| 기존 상담일지 데이터 이전 | 1차 필수 아님. 신규 행사부터 동적 템플릿 적용. 필요 시 별도 pivot 마이그레이션 |
| 빌더 위치 | 행사 상세 `/admin/events/:eventId`에 `상담일지 설정` 탭 추가 |
| 편집 잠금 | 행사 `DRAFT`/`BOOKING`/`ALLOCATION`이고 해당 행사 상담일지 응답이 0건일 때만 편집 가능 |
| 문항 순서 변경 | 만족도 빌더와 동일하게 ▲/▼ 버튼 우선 적용 |
| 드래그앤드롭 | 1차 제외 |
| 결과 리포트 | 1차에서는 관리자 조회/CSV 범위까지 포함 권장. Phase 7 내보내기와 연결 가능 |

---

## 4. 데이터 모델 제안

만족도 조사(`survey_questions`, `survey_responses`, `survey_answers`)를 그대로 재사용할 수도 있지만, 상담일지는 제출 기준과 권한, 트랜잭션이 다릅니다. 따라서 별도 테이블을 권장합니다.

### 4.1 `counseling_log_questions`

행사별 상담일지 문항 정의입니다.

주요 컬럼:
- `id uuid`
- `event_id uuid references events(id) on delete cascade`
- `question_type text`
- `title text`
- `description text`
- `options jsonb`
- `is_required boolean default true`
- `order_no int`
- `answer_visibility text default 'ADMIN_ONLY'`
- `system_key text null`
- `created_at timestamptz`
- `updated_at timestamptz`

`system_key` 권장 용도:
- 기본 템플릿/호환 필드를 식별합니다.
- 예: `score_technology`, `score_expertise`, `content`, `follow_up_required`, `follow_up_memo`, `public_comment`.
- 운영자가 제목은 바꾸더라도 시스템이 공개 코멘트나 레거시 컬럼 매핑을 안정적으로 찾을 수 있습니다.

### 4.2 `counseling_log_answers`

상담 슬롯별 문항 답변입니다. `counseling_logs`가 제출 마스터 역할을 하므로 별도 response 테이블은 만들지 않는 편이 단순합니다.

주요 컬럼:
- `id uuid`
- `counseling_log_id uuid references counseling_logs(id) on delete cascade`
- `question_id uuid references counseling_log_questions(id) on delete restrict`
- `answer_text text`
- `answer_rating int check (answer_rating between 1 and 5)`
- `answer_selections jsonb`
- `created_at timestamptz`
- `updated_at timestamptz`
- `unique(counseling_log_id, question_id)`

### 4.3 기존 `counseling_logs`와의 관계

`counseling_logs`는 계속 다음 책임을 가집니다.
- `matching_slot_id`별 1개 일지 보장
- 제출 시각(`submitted_at`)
- 기존 공개 코멘트 호환(`content`, `is_public`)
- 후속 연계 호환(`follow_up_required`, `follow_up_memo`)
- 레거시 점수 컬럼 보존

동적 답변은 `counseling_log_answers`에 저장합니다. 단, 기본 `system_key`가 있는 문항은 필요 시 기존 컬럼에도 동기화해 기존 화면과 공개 코멘트 RPC를 깨지 않게 합니다.

---

## 5. RPC 설계 제안

기존 RPC 시그니처는 고정 점수 파라미터를 받습니다.

- `save_counseling_draft(p_slot_id, p_score_..., p_content, ...)`
- `submit_counseling_log(p_slot_id, p_score_..., p_content, ...)`

동적 문항 적용 후에는 JSONB 답변 배열을 받는 신규 RPC를 추가하는 방식을 권장합니다.

### 5.1 신규 RPC

- `save_counseling_log_draft_v2(p_slot_id uuid, p_answers jsonb, p_follow_up_required boolean, p_follow_up_memo text, p_is_public boolean)`
- `submit_counseling_log_v2(p_slot_id uuid, p_answers jsonb, p_follow_up_required boolean, p_follow_up_memo text, p_is_public boolean)`

`p_answers` 형식:

```json
[
  {
    "question_id": "uuid",
    "answer_rating": 4,
    "answer_text": null,
    "answer_selections": null
  }
]
```

### 5.2 서버 검증

두 RPC 모두 공통 검증:
- 현재 로그인 사용자가 해당 슬롯의 전문가인지 확인
- 슬롯 존재 및 `expert_id = current_app_user_id()`
- 행사 `FINISHED` 이후 저장/제출 차단
- 문항이 슬롯의 `event_id`에 속하는지 확인
- 타입별 답변 형식 검증
- 선택형 답변이 문항 `options` 안에 포함되는지 확인

최종 제출 전용 검증:
- 모든 필수 문항 입력 확인
- `matching_slots.session_status`가 제출 가능한 상태인지 확인
- 답변 저장과 `matching_slots.session_status = 'COMPLETED'` 전환을 단일 트랜잭션으로 처리
- 이미 제출된 일지를 수정 제출하는 경우 기존처럼 감사 로그 `EDIT_COUNSELING_LOG` 기록

### 5.3 레거시 RPC 유지

기존 프론트/테스트 안정성을 위해 레거시 RPC는 즉시 삭제하지 않습니다.

권장 순서:
1. 신규 RPC 추가
2. 프론트 상담일지 모달을 v2로 전환
3. 공개 코멘트/이전 이력/관리자 리포트가 v2 답변을 읽도록 확장
4. 레거시 RPC와 고정 점수 컬럼의 제거 여부는 별도 마이그레이션에서 판단

---

## 6. 관리자 UI: 상담일지 설정

진입: 행사 상세 `/admin/events/:eventId` → `상담일지 설정` 탭.

만족도 조사 빌더와 최대한 같은 사용성을 재사용합니다.

필수 기능:
- 문항 목록 카드
- 문항 추가/수정/삭제
- 문항 유형 선택
- 필수 여부 토글
- 객관식 선택지 관리
- ▲/▼ 순서 변경
- 기본 상담일지 템플릿 불러오기
- 편집 잠금 배너

편집 잠금 사유:
- 상담일지 답변이 이미 1건 이상 존재
- 행사 상태가 `PROGRESS`, `FINISHED`, `CANCELLED`

기본 템플릿:
- 기술성 — RATING
- 전문성 — RATING
- 신뢰도 — RATING
- 협업 잠재력 — RATING
- 거래 가능성 — RATING
- 상담 의견 — LONG_ANSWER

후속 연계와 공개 여부는 문항으로 넣기보다 기존 상담일지 메타 필드로 유지하는 것을 권장합니다. 운영상 항상 필요한 처리 플래그이고, 공개 정책과 알림/후속 업무에 연결될 가능성이 높기 때문입니다.

---

## 7. 전문가 UI: 동적 상담일지 모달

현재 `CounselingLogModal`은 `SCORECARD_ITEMS.map(...)`으로 고정 점수 행을 렌더링합니다. 변경 후에는 행사별 문항 정의를 조회해 유형별 입력 컴포넌트를 렌더링합니다.

필요 변경:
- `useCounselingLogQuestions(eventId)` 추가
- `useCounselingLog(slotId)`가 기존 로그 + 동적 답변을 함께 반환하도록 확장
- `CounselingDraft`를 고정 `scores` 구조에서 `answersByQuestionId` 구조로 변경
- `validateSubmit`이 문항 정의 기반으로 필수/타입 검증
- `toRpcArgs`가 v2 RPC JSONB 인자로 변환

UI 원칙:
- RATING은 현재 1~5 큰 버튼 UI를 유지
- LONG_ANSWER는 기존 상담 의견 textarea와 동일한 사용성 유지
- SINGLE/MULTIPLE은 만족도 폼의 카드형 선택 UI 재사용
- 최종 제출 버튼 문구 `상담 완료 및 제출` 유지
- 임시저장 버튼 유지

---

## 8. 조회/공개/리포트

### 8.1 전문가 이전 상담 이력

`CounselingLogSummary`는 기존 5개 점수 대신 동적 문항 답변 요약을 렌더링해야 합니다.

표시 방식:
- RATING: 문항명 + 점수
- 선택형: 문항명 + 선택값
- 주관식: 문항명 + 텍스트
- 공개 여부/후속 연계는 기존처럼 별도 배지와 메모로 표시

### 8.2 스타트업 공개 코멘트

스타트업에는 내부 평가 답변을 공개하지 않습니다.

1차 권장안:
- `system_key = 'content'` 또는 기존 `counseling_logs.content`를 공개 코멘트의 원천으로 유지
- `is_public = true`일 때만 기존 `list_public_comments(p_event_id)`가 안전 컬럼만 반환

### 8.3 관리자 결과/CSV

관리자는 행사 종료 후 상담일지 결과를 CSV로 내려받을 수 있어야 합니다.

CSV 권장 열:
- 행사명
- 상담 일시
- 전문가명/소속
- 스타트업명
- 세션 상태
- 제출 시각
- 후속 연계 여부
- 후속 연계 메모
- 문항별 답변

만족도 리포트의 CSV 유틸 패턴을 재사용하되, 행 기준은 `survey_responses`가 아니라 `counseling_logs + matching_slots`입니다.

---

## 9. 구현 슬라이스 제안

### 슬라이스 A — 데이터 모델 + 기본 템플릿
- [ ] `counseling_log_questions` / `counseling_log_answers` 마이그레이션 추가
- [ ] 행사 생성 시 기본 상담일지 문항 자동 생성 함수/트리거 추가
- [ ] 기존 행사 backfill
- [ ] RLS: 문항은 참가자 SELECT/ADMIN 쓰기, 답변은 전문가 본인+ADMIN SELECT
- [ ] dev seed: PROGRESS 행사에 커스텀 상담일지 문항 예시 추가

### 슬라이스 B — v2 저장/제출 RPC
- [ ] `save_counseling_log_draft_v2`
- [ ] `submit_counseling_log_v2`
- [ ] 필수/타입/선택지 서버 검증
- [ ] 제출 시 `COMPLETED` 전환
- [ ] 수정 제출 감사 로그 유지
- [ ] 레거시 컬럼 동기화 정책 확정 및 구현

### 슬라이스 C — 관리자 상담일지 빌더
- [ ] 행사 상세에 `상담일지 설정` 탭 추가
- [ ] 문항 CRUD/순서/기본 템플릿 불러오기
- [ ] 편집 잠금
- [ ] 만족도 빌더 공통 로직 재사용 가능성 검토

### 슬라이스 D — 전문가 동적 상담일지 모달
- [ ] `SCORECARD_ITEMS` 고정 렌더 제거
- [ ] 문항 정의 기반 렌더링
- [ ] 임시저장/최종 제출 v2 RPC 연결
- [ ] 기존 제출 일지 수정 화면에서 동적 답변 시드
- [ ] 단위 테스트 갱신

### 슬라이스 E — 조회/CSV/공개 코멘트 정합성
- [ ] 이전 상담 이력 요약 동적 렌더링
- [ ] 관리자 상담 결과 CSV 확장
- [ ] 스타트업 공개 코멘트가 내부 답변을 노출하지 않는지 검증
- [ ] 라이브 라운드트립 검증

---

## 10. 주의할 점

- 상담일지는 만족도 조사와 달리 **세션 완료 상태 전환**을 포함합니다. 단순 문항 CRUD만으로 끝나지 않고 `matching_slots.session_status`와 반드시 트랜잭션으로 묶어야 합니다.
- 임시저장은 필수 문항 누락을 허용해야 합니다.
- 최종 제출은 필수 문항 누락을 서버에서 차단해야 합니다.
- 문항 편집은 응답 발생 후 잠그는 것이 안전합니다. 이미 제출된 답변의 의미가 바뀌는 것을 막기 위함입니다.
- 스타트업 공개 범위는 반드시 텍스트 코멘트로 제한합니다. 점수/선택형/내부 주관식 답변이 공개 RPC나 RLS를 통해 새지 않도록 별도 검증이 필요합니다.
- 기존 `counseling_logs` 고정 컬럼을 바로 제거하면 공개 코멘트, 이전 이력, 테스트, CSV가 연쇄적으로 깨질 수 있습니다. 1차 구현은 병행 저장을 권장합니다.

---

## 11. 완료 기준

- 관리자가 행사별 상담일지 문항을 생성/수정/삭제/정렬할 수 있습니다.
- 전문가가 상담 슬롯별로 커스텀 문항 기반 일지를 임시저장할 수 있습니다.
- 전문가가 필수 문항을 모두 입력해야 상담 완료 및 제출할 수 있습니다.
- 제출과 `COMPLETED` 전환이 하나의 트랜잭션으로 처리됩니다.
- 기존 스타트업 공개 코멘트 정책이 유지됩니다.
- 기존 기본 5개 스코어카드와 동일한 템플릿이 신규/기존 행사에 기본 생성됩니다.
- lint, typecheck, build, test가 통과합니다.
- PROGRESS 시드 행사에서 관리자 빌더 → 전문가 작성/제출 → 이전 이력/공개 코멘트/CSV 확인까지 라운드트립 검증이 가능합니다.
