# [기능 명세] 행사별 만족도 조사 커스터마이징 (Survey Customization)

본 문서는 행사마다 서로 다른 구성의 만족도 조사를 설계·배포·집계하는 **동적 설문 기능**의 구현 사양과 진행 체크리스트를 정의합니다. 기획 원안은 [survey_customization_ideation.md](./survey_customization_ideation.md), 작업 로그는 [worklog_survey_customization.md](./worklog_survey_customization.md) 입니다.

> **요약**: 고정형 4점+의견 설문(`satisfaction_surveys`)을 **행사별로 문항을 자유롭게 구성하는 동적 설문**으로 확장했다. 관리자가 문항을 짜고(빌더) → 참가자가 응답하고 → 관리자가 결과를 집계·CSV 추출하는 전 사이클(슬라이스 A·B·C)을 STARTUP 대상으로 완성했다. EXPERT 대상(슬라이스 D)은 Phase 6 전문가 대시보드와 함께 진행한다.

---

## 1. 범위 결정 (Scope Decisions)

| 항목 | 결정 |
|---|---|
| 레거시 데이터 | `satisfaction_surveys` 정교한 pivot 이전 안 함 → 신규 테이블 + 기본 템플릿 자동 생성. 구 테이블은 deprecated 보존 |
| 익명 설문 | 1차 제외 (1인 1회 제출 불변식과 충돌 → 별도 설계 시 재논의) |
| EXPERT 설문 | 이번 범위 제외 → **Phase 6 전문가 대시보드와 합류**(슬라이스 D). 단, 데이터 모델·빌더·집계는 EXPERT 도 지원하도록 미리 구현 |
| 결과 내보내기 | CSV (xlsx 의존성 미도입) |
| 빌더 순서 변경 | ▲/▼ 버튼 (드래그앤드롭 미도입) |
| 문항 편집 잠금 | **첫 응답 발생 또는 행사 PROGRESS/FINISHED 이후 편집 차단**(응답 정합성 보호) |

---

## 2. 데이터 모델 (Migration `0025_survey_customization.sql`)

기존 `satisfaction_surveys`(고정 컬럼)를 대체하는 1:N 동적 구조.

### 2.1 테이블
- **`survey_questions`** — 행사별 문항 정의.
  - `event_id`, `target_role`(`STARTUP`|`EXPERT`|`ALL`), `question_type`(`SINGLE_CHOICE`|`MULTIPLE_CHOICE`|`SHORT_ANSWER`|`LONG_ANSWER`|`RATING`), `title`, `description`, `options`(jsonb, 객관식 선택지), `is_required`, `order_no`.
- **`survey_responses`** — 제출 마스터. `UNIQUE(event_id, user_id)` 로 **행사당 1인 1회** 보장. `user_role`, `submitted_at`.
- **`survey_answers`** — 문항별 답변. `response_id`, `question_id`, `answer_text` / `answer_rating`(1~5) / `answer_selections`(jsonb). `UNIQUE(response_id, question_id)`.

### 2.2 RLS
- `survey_questions`: 참가자는 본인 행사 문항 **SELECT만**(`is_event_participant`), INSERT/UPDATE/DELETE 는 **ADMIN**.
- `survey_responses` / `survey_answers`: 본인 + ADMIN **SELECT만**. **직접 INSERT 정책 없음**(= 아래 RPC 경유만 허용), UPDATE/DELETE 없음(제출 후 수정 불가).

### 2.3 기본 문항 자동 프로비저닝
- `ensure_default_survey_questions(event_id)` — 문항이 0개일 때만 레거시 승계 5문항(RATING 4 + LONG_ANSWER 1) 생성.
- `events` AFTER INSERT 트리거 `event_default_survey_after_insert` — **새 행사 생성 시 자동 기본 문항 부여**.
- 마이그레이션에서 기존 행사 전체 backfill → **관리자 빌더 이전에도 모든 행사에 문항이 존재**.

### 2.4 제출 RPC — `submit_survey(p_event_id uuid, p_answers jsonb)` (SECURITY DEFINER)
- `p_answers` 형식: `[{ question_id, answer_rating?, answer_text?, answer_selections? }]`.
- 서버 재검증(권위): 로그인 · role(STARTUP/EXPERT) · **행사 FINISHED** · `is_event_participant` · 문항의 event 소속 · **필수 누락** · 타입별 형식(RATING 1~5 / SINGLE 1개 / 선택지 ⊆ options) · **1회 제출**(UNIQUE 23505 → 친절 메시지).
- 응답 마스터 + 답변을 **단일 트랜잭션**으로 저장(부분 저장 방지).
- 권한: `REVOKE EXECUTE … FROM anon` 명시 후 `authenticated` 에만 부여(0023 패턴).

---

## 3. 관리자 설문 빌더 (슬라이스 B)

진입: 행사 상세 `/admin/events/:eventId` → **"만족도 설정" 탭** (`SurveyBuilderPanel`).

- **역할 탭**: 스타트업용 / 전문가용 (각 탭의 문항 수 배지).
- **문항 카드 목록**: 유형 배지·필수 배지·객관식 선택지 칩, **▲/▼ 순서 변경**(`order_no` 맞교환), 수정·삭제.
- **문항 편집 모달**: 유형 셀렉터(5종) · 제목 · 보조 설명 · 객관식 선택지 추가/삭제 · 필수 토글. 검증 `questionFormSchema`(객관식 선택지 2개 이상·중복 금지).
- **기본 문항 불러오기**: 문항 0개일 때 레거시 템플릿 일괄 추가.
- **편집 잠금**(`canEditSurvey`/`editLockReason`): DRAFT/BOOKING/ALLOCATION + 응답 0건일 때만 편집. 응답 발생 / PROGRESS / FINISHED / CANCELLED 면 **읽기 전용 + 사유 배너**.
- 데이터 경로는 operator `supabase`(ADMIN), 신규 마이그레이션 없음(권한은 0025 RLS).

---

## 4. 참가자 응답 폼 (슬라이스 A)

진입: 행사 `FINISHED` 단계에서 `StartupPortalView` 가 예약 일정표 대신 `SatisfactionPanel` 노출.

- 문항 정의를 받아 **유형별 입력 위젯 동적 렌더**: 별점 세그먼트 / 라디오 카드(단일) / 체크박스 카드(복수) / 단답 입력 / 서술 textarea.
- 제출 전 = 폼, 제출 후 = **읽기 전용 요약**(행사당 1회·수정 불가).
- 클라이언트 1차 검증(`validateSurvey`) 후 `submit_survey` RPC 호출. 모든 경로는 `participantClient`(참가자 커스텀 JWT).

---

## 5. 결과 리포트 + CSV (슬라이스 C)

진입: 행사 상세 → **"만족도 결과" 탭** (`SurveyReportPanel`).

- **역할 탭** + **응답률 카드**(제출/대상 %).
- **문항별 집계**(`aggregateQuestion`): 평점=평균+1~5 분포 막대 / 객관식=선택지별 비율 막대 / 주관식=응답 카드 목록.
- **CSV 내보내기**(`toCsv`): 행=응답자, 열=제출시각·유형·기업/소속·성명·문항…, 복수선택 ", " 결합, **UTF-8 BOM**(엑셀 한글). xlsx 미사용.
- 데이터는 operator `supabase`(ADMIN RLS 전체 SELECT) — 별도 집계 RPC/뷰 불필요. 막대는 공용 `lib/percentBar`(정적 5% width 클래스, 인라인 스타일 금지 대응).

---

## 6. 구현 체크리스트 (Implementation Checklist)

### 슬라이스 A — 데이터 모델 + 참가자 응답 ✅ 완료·배포 (2026-06-26)
- [x] `0025` 3테이블 + RLS + 기본 문항 트리거/backfill + `submit_survey` RPC
- [x] 프론트 `types/lib/schemas/hooks/satisfaction` 동적 재작성 + `SatisfactionPanel` 동적 폼
- [x] 옛 정적 `RATING_ITEMS`/`satisfactionSchema`/`SatisfactionSurveyRow` 제거
- [x] db push(Local=Remote 0001~0025) + anon 스모크(submit_survey 401 / questions RLS 200 `[]`)

### 슬라이스 B — 관리자 빌더 ✅ 완료 (2026-06-26)
- [x] 문항 CRUD·순서(operator supabase, RLS 0025) — **신규 마이그레이션 없음**
- [x] `types#SurveyQuestionInput`·`lib/surveyBuilder`·`schemas/surveyBuilderSchemas`·`hooks/useSurveyBuilder`
- [x] `SurveyBuilderPanel`(역할 탭·유형 셀렉터·선택지·필수·▲▼·편집 잠금) + 상세 탭 연결

### 슬라이스 C — 결과 리포트 + CSV ✅ 완료 (2026-06-26)
- [x] `lib/surveyReport`(집계·CSV 순수함수)·`lib/percentBar`·`hooks/useSurveyReport`
- [x] `SurveyReportPanel`(응답률·평점 분포·객관식 비율·주관식 목록·CSV) + 상세 탭 연결
- [x] **기능 마이그레이션 없음** — dev seed `0026~0029`만(예시 문항·샘플 응답, 화면 확인용·롤백스니펫 보유)

### 검증/품질
- [x] lint·typecheck·build·test 통과 (총 136, 만족도 관련 신규 30)
- [ ] ⚠ **라이브 풀 라운드트립 미검증** — 관리자 로그인(빌더 CRUD·결과·CSV) / 참가자 로그인(FINISHED 응답 제출)

### 범위 밖 (이후)
- [ ] 슬라이스 D — EXPERT 대상 설문(전문가 포탈 노출, **Phase 6 합류**)
- [ ] 백로그 — 상담 건별 세션 만족도 / 익명 설문 / 리포트 PDF 출력

---

## 7. dev seed 마이그레이션 (화면 확인용 더미)

| 번호 | 내용 |
|---|---|
| `0026` | 행사 A(BOOKING)에 만족도 5유형 예시 문항(STARTUP +3유형, EXPERT +3) |
| `0027` | 행사 C(FINISHED)에 동일 예시 문항 |
| `0028` | 행사 C 샘플 응답 1건 |
| `0029` | 행사 C 스타트업 06~12 참가자 추가 + 응답 7건(총 8건, 결과 탭 가시화) |

각 파일 하단 롤백 스니펫으로 정리 가능. 운영 데이터가 아니다.
