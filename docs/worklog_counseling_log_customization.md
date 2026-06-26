# 작업 로그 — 전문가 상담일지 평가표 커스터마이징

기획: [counseling_log_customization.md](./counseling_log_customization.md)
완료일: 2026-06-26 · 배포: Local=Remote 0001~0033 · lint/typecheck/build/test(176) 통과

기존 고정형 스코어카드(`SCORECARD_ITEMS` + `counseling_logs` 고정 컬럼)를 행사별 동적 문항
모델로 확장했다. 만족도 조사 커스터마이징(0025)과 동일 패턴을 재사용하되, 상담일지 고유의
**세션 완료(COMPLETED) 트랜잭션 전환**과 **레거시 컬럼 양방향 동기화**를 추가했다.

---

## 슬라이스 A — 데이터 모델 + 기본 템플릿 (`0032`)

- `counseling_log_questions`(행사별 문항) / `counseling_log_answers`(상담일지별 답변) 2테이블 + RLS.
  - questions: 참가자 SELECT / ADMIN 쓰기. answers: 작성 전문가 본인 + ADMIN SELECT만(직접 INSERT 정책 없음 → v2 RPC 경유). ⭐스타트업은 내부 답변 접근 불가.
- `system_key`(score_technology … content)로 기본 6문항을 레거시 컬럼과 1:1 매핑.
  - `(event_id, system_key)` 부분 UNIQUE 인덱스로 매핑 무결성 보장.
- `ensure_default_counseling_questions` + 행사 생성 트리거 + 기존 행사 backfill(멱등).
- dev seed: PROGRESS 행사(D)에 커스텀 문항 2개(투자 단계 SINGLE_CHOICE / 핵심 액션 SHORT_ANSWER) +
  기존 COMPLETED 일지의 레거시 점수/의견을 동적 답변으로 backfill.

## 슬라이스 B — v2 저장/제출 RPC (`0033`)

- `save_counseling_log_draft_v2(p_slot_id, p_answers, p_follow_up_required, p_follow_up_memo, p_is_public)` — 부분 입력 허용, COMPLETED 전환 없음.
- `submit_counseling_log_v2(...)` — 필수 문항 검증 + `matching_slots.session_status='COMPLETED'` 전환을 **단일 트랜잭션**으로 처리, COMPLETED 재제출 시 `EDIT_COUNSELING_LOG` 감사로그.
- 내부 헬퍼 `_process_counseling_answers`(delete-then-insert + 타입/필수/선택지 검증) +
  `_clog_sync_rating`/`_clog_sync_text`로 **system_key 문항 → 레거시 컬럼 동기화**.
  → 기존 화면·`list_public_comments`(0023)·CSV 가 깨지지 않음.
- 레거시 RPC(0005 `save_counseling_draft`/`submit_counseling_log`)는 보존.
- anon EXECUTE 회수(0023 패턴) — anon 스모크: draft→401, submit→42501 차단 확인.

## 슬라이스 C — 관리자 상담일지 빌더

- `lib/counselingBuilder`(유형 메타·편집 잠금·기본 템플릿) + `schemas/counselingBuilderSchemas` +
  `hooks/useCounselingBuilder`(operator supabase, 답변 수 집계로 잠금 판정) +
  `components/admin/CounselingBuilderPanel`(역할 탭 없는 단일 목록, ▲/▼ 순서, 기본 항목 배지).
- 편집 잠금: DRAFT/BOOKING/ALLOCATION + 답변 0건일 때만. PROGRESS/FINISHED/CANCELLED·답변 발생 시 읽기 전용.
- `EventDetailView`에 `상담일지 설정` 탭 추가.

## 슬라이스 D — 전문가 동적 상담일지 모달

- `lib/counseling` 전면 동적화: `CounselingDraft`(answers by questionId + 메타) / `draftFromLog`
  (동적 답변 우선, 없으면 system_key 레거시 fallback) / `validateSubmit` / `toRpcArgsV2`.
- `hooks/useExpertPortal`: `useCounselingLogQuestions` 추가, `useCounselingLog`가 마스터+답변 번들 반환,
  save/submit 훅 v2 전환, 이전 이력 훅이 문항·답변 동봉.
- `components/expert/CounselingLogModal` 동적 렌더(RATING 큰 버튼·객관식 카드·주관식). 후속/공개는 메타 필드 유지.
  - "이미 제출됨" 판정은 `slot.session_status==='COMPLETED'`로(임시저장 행도 submitted_at 기본값이 채워지므로).
- `test/counseling.test.ts` 동적 구조로 재작성(14) + `test/counselingBuilder.test.ts` 신규(14).

## 슬라이스 E — 조회/CSV/공개 코멘트 정합성

- `components/expert/CounselingLogSummary` 동적 렌더(문항·답변 기반) + `ExpertHistoryView` 연결.
- 관리자 CSV: `lib/counselingReport`(answerToDisplay·ratingAverage·toCsv 재사용) +
  `hooks/useCounselingReport`(counseling_logs + matching_slots + answers) +
  `components/admin/CounselingReportPanel`(작성 현황·평점 평균·CSV) + `상담일지 결과` 탭.
  - CSV 열: 행사명·상담일시·전문가소속·스타트업·세션상태·제출시각·후속연계·후속메모·문항별 답변.
- 공개 코멘트 정합성: 스타트업은 `list_public_comments`(content·is_public)만 노출, `counseling_log_answers`는
  RLS상 스타트업 접근 불가. anon SELECT 스모크 `[]` 확인.

---

## 남은 검증 (라이브)

PROGRESS 시드 행사(D)에서 관리자 빌더(잠금 배너) → 전문가 OTP 로그인 → 상담일지 작성/제출
(IN_PROGRESS 슬롯) → 이전 이력/CSV 라운드트립은 **실 계정 로그인 필요**로 미수행. 코드/배포/스모크는 완료.
