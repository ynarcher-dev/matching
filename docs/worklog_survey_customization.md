# 만족도 조사 커스터마이징 — 작업 체크리스트 (Worklog)

> 기획 출처: [`survey_customization_ideation.md`](survey_customization_ideation.md)
> 고정형 `satisfaction_surveys`(4점+의견) → **행사별 동적 설문** 모델로 확장.
> 이번 태스크 완료 기준 = **슬라이스 A + B + C** (STARTUP 대상 풀 사이클). D(EXPERT)는 Phase 6 합류로 범위 밖.

## 결정된 1차 범위 (확정)

- [x] 레거시 데이터 정교한 pivot 이전 **안 함** — 신규 테이블 + 기본 템플릿 seed, 구 `satisfaction_surveys`는 deprecated 보존
- [x] 익명 설문 **제외** (1인 1회 불변식과 충돌 → 별도 설계 필요 시 재논의)
- [x] EXPERT 설문 **제외** → Phase 6 전문가 대시보드와 합류
- [x] 내보내기 **CSV** (xlsx 의존성 추가 안 함)
- [x] 관리자 빌더 순서 변경은 **▲/▼ 버튼** (드래그앤드롭 미도입)
- [x] 질문 편집 잠금: **첫 응답 발생 또는 PROGRESS 진입 이후** 편집 차단

---

## 슬라이스 A — 데이터 모델 + 참가자 동적 응답 ✅ 완료·배포 (2026-06-26)

- [x] `0025_survey_customization.sql` — `survey_questions` / `survey_responses` / `survey_answers` 3테이블
- [x] RLS — questions(참가자 SELECT·ADMIN 쓰기), responses·answers(본인+ADMIN SELECT만, INSERT 정책 없음=RPC 경유, UPDATE/DELETE 없음)
- [x] 기본 질문 자동 프로비저닝 — `ensure_default_survey_questions` + `events` AFTER INSERT 트리거 + 기존 행사 backfill
- [x] `submit_survey(event_id, answers jsonb)` SECURITY DEFINER RPC (FINISHED·참가자·role·필수·옵션·1회 서버 재검증, anon EXECUTE 회수)
- [x] 프론트 — `types/lib/schemas/hooks/satisfaction` 동적 재작성 + `SatisfactionPanel` 동적 폼 렌더러
- [x] 옛 정적 `RATING_ITEMS` / `satisfactionSchema` / `SatisfactionSurveyRow` 의존 제거
- [x] lint/typecheck/build/test(115) 통과
- [x] db push (Local=Remote 0001~0025) + anon 스모크(submit_survey 401 / questions RLS 200 `[]`)
- [ ] ⚠ 라이브 폼 라운드트립 미검증 (FINISHED 행사 스타트업 OTP 로그인 → 제출)

---

## 슬라이스 B — 관리자 설문 빌더 ✅ 완료 (2026-06-26)

목표: 관리자가 행사 상세에서 **행사별 문항을 직접 구성**. (DRAFT/BOOKING/ALLOCATION 단계 편집 가능)

- [x] 관리자 문항 조회/생성/수정/삭제 경로 (operator `supabase`, RLS 0025 ADMIN 쓰기)
- [x] **마이그레이션 불필요** — 단건 INSERT/UPDATE/DELETE + 순서 swap 2건 UPDATE로 충분 (권한은 0025에 포함)
- [x] `types`(SurveyQuestionInput)/`lib/surveyBuilder`(검증·잠금·템플릿 순수함수)/`schemas/surveyBuilderSchemas`/`hooks/useSurveyBuilder` 추가
- [x] 빌더 UI(`components/admin/SurveyBuilderPanel`) — 스타트업/전문가 탭, 유형 셀렉터(5종), 제목·보조설명, 객관식 선택지 추가/삭제, 필수 토글, ▲/▼ 순서(order_no swap)
- [x] "기본 문항 불러오기" 버튼 (문항 0개일 때 `defaultTemplate` 일괄 추가)
- [x] **편집 잠금**: 응답 1건이라도 있거나 행사 PROGRESS/FINISHED/CANCELLED면 편집 비활성 + 사유 배너 (`canEditSurvey`/`editLockReason`)
- [x] `EventDetailView`에 "만족도 설정" 탭 연결
- [x] lint/typecheck/build/test(128, 빌더 13 신규) 통과
- [x] (마이그레이션 없음 → db push 불필요)
- [~] dev seed — 별도 커스텀 문항 시드는 생략(기본 문항 자동 프로비저닝으로 화면 확인 가능, 결과 가시화는 슬라이스 C)
- [ ] ⚠ 라이브 빌더 라운드트립 미검증 (관리자 로그인 → 문항 추가/수정/순서/삭제)

---

## 슬라이스 C — 결과 리포트 + CSV 내보내기 ✅ 완료 (2026-06-26)

목표: 관리자가 **응답률·문항별 집계를 보고 CSV로 추출**. (PROGRESS/FINISHED 단계)

- [x] 결과 집계 조회 경로 — `hooks/useSurveyReport`(survey_responses + survey_answers 임베드, ADMIN RLS), 클라 집계로 충분(별도 RPC/뷰 불필요)
- [x] `lib/surveyReport`(aggregateQuestion/responseRate/answerToDisplay/toCsv 순수함수, +test8) + `lib/percentBar`(공용 width 버킷)
- [x] 리포트 UI(`components/admin/SurveyReportPanel`) — 역할 탭, 응답률 카드, 평점 평균+1~5 분포 막대, 객관식 선택지 비율 막대, 주관식 카드 목록
- [x] CSV 내보내기 — 행=응답자, 열=제출시각·유형·기업/소속·성명·문항…, 복수선택 ", " 결합, UTF-8 BOM(엑셀 한글), xlsx 미사용
- [x] 행사 상세에 "만족도 결과" 탭 연결
- [x] lint/typecheck/build/test(136, 리포트 8 신규) 통과
- [x] **기능 마이그레이션 없음**(기존 테이블 조회) — dev seed만: `0028`(행사 C 응답 1)·`0029`(참가자 06~12 추가 + 응답 7) db push 완료 → 결과 탭 8건 가시화
- [ ] ⚠ 라이브 리포트/CSV 라운드트립 미검증(관리자 로그인 행사 C → 결과 탭·CSV 다운로드)

> **이번 태스크(A+B+C) 코드/배포 완료.** 남은 것은 라이브 화면 검증과 범위 밖 D(EXPERT, Phase 6).

---

## 이후(범위 밖, Phase 6 합류)

- [ ] 슬라이스 D — EXPERT 대상 설문 (전문가 포탈에서 노출)
- [ ] (백로그) 상담 건별 세션 만족도, 익명 설문, 리포트 PDF 출력
