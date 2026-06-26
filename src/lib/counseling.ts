/**
 * 디지털 상담일지(동적 문항) 순수 함수.
 * 출처: docs/counseling_log_customization.md §5, §7.
 * 행사별 문항 정의(CounselingQuestion[])를 받아 폼 상태(draft) 변환·검증·v2 RPC 페이로드를
 * 만든다. 후속 연계·공개 여부는 문항이 아니라 상담일지 메타 필드로 유지한다(§6).
 *
 * ⭐레거시 호환: 기본 템플릿 문항은 system_key(score_* / content)로 counseling_logs 레거시
 * 컬럼과 매핑된다. 동적 답변이 없는 기존 일지는 system_key 로 레거시 컬럼을 fallback 으로
 * 읽어 폼을 시드한다(v2 RPC 가 저장 시 레거시 컬럼을 다시 동기화한다).
 */

import type {
  CounselingAnswerInput,
  CounselingAnswerRow,
  CounselingQuestion,
  CounselingQuestionType,
} from '@/types/counselingLog';
import type { CounselingLogRow } from '@/types/expert';

/** 5점 척도. */
export const RATING_SCALE = [1, 2, 3, 4, 5] as const;

/** 주관식 유형별 최대 길이. */
export const SHORT_ANSWER_MAX = 200;
export const LONG_ANSWER_MAX = 1000;
/** 후속 연계 메모 최대 길이(UI 카운터·과도 입력 방지용). */
export const FOLLOWUP_MEMO_MAX = 500;

/** 주관식 유형별 최대 길이. */
export function textMaxFor(type: CounselingQuestionType): number {
  return type === 'SHORT_ANSWER' ? SHORT_ANSWER_MAX : LONG_ANSWER_MAX;
}

/** 1~5 사이의 정수 평점인가. */
export function isValidRating(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

/** 한 문항에 대한 입력값(평점/텍스트/선택). */
export interface CounselingAnswerValue {
  rating?: number;
  text?: string;
  selections?: string[];
}

/** 상담일지 폼 상태(문항 id → 입력값 + 메타 필드). */
export interface CounselingDraft {
  answers: Record<string, CounselingAnswerValue>;
  followUpRequired: boolean;
  followUpMemo: string;
  isPublic: boolean;
}

/** 빈 폼(신규 작성). */
export function emptyDraft(): CounselingDraft {
  return { answers: {}, followUpRequired: false, followUpMemo: '', isPublic: false };
}

/** 레거시 점수 컬럼 system_key 집합. */
const LEGACY_SCORE_KEYS = new Set([
  'score_technology',
  'score_expertise',
  'score_reliability',
  'score_collaboration',
  'score_probability',
]);

/** system_key 문항에 대해 레거시 컬럼값을 입력값으로 변환(동적 답변이 없을 때 fallback). */
function legacyValueFor(
  systemKey: string | null,
  log: CounselingLogRow | null,
): CounselingAnswerValue | null {
  if (!log || !systemKey) return null;
  if (LEGACY_SCORE_KEYS.has(systemKey)) {
    const v = (log as unknown as Record<string, number | null>)[systemKey];
    return v != null ? { rating: v } : null;
  }
  if (systemKey === 'content') {
    return log.content ? { text: log.content } : null;
  }
  return null;
}

/** 기존 로그 + 동적 답변 → 폼 상태(임시저장/수정 이어쓰기). 답변이 없으면 레거시 컬럼 fallback. */
export function draftFromLog(
  questions: CounselingQuestion[],
  log: CounselingLogRow | null,
  answers: CounselingAnswerRow[],
): CounselingDraft {
  const answerByQ = new Map(answers.map((a) => [a.question_id, a]));
  const result: Record<string, CounselingAnswerValue> = {};

  for (const q of questions) {
    const a = answerByQ.get(q.id);
    if (a) {
      result[q.id] = {
        rating: a.answer_rating ?? undefined,
        text: a.answer_text ?? undefined,
        selections: a.answer_selections ?? undefined,
      };
    } else {
      const legacy = legacyValueFor(q.system_key, log);
      if (legacy) result[q.id] = legacy;
    }
  }

  return {
    answers: result,
    followUpRequired: log?.follow_up_required ?? false,
    followUpMemo: log?.follow_up_memo ?? '',
    isPublic: log?.is_public ?? false,
  };
}

/** 한 문항이 "응답됨"으로 볼 수 있는가. */
export function isAnswered(q: CounselingQuestion, draft: CounselingDraft): boolean {
  const v = draft.answers[q.id];
  if (!v) return false;
  switch (q.question_type) {
    case 'RATING':
      return isValidRating(v.rating);
    case 'SHORT_ANSWER':
    case 'LONG_ANSWER':
      return Boolean(v.text && v.text.trim().length > 0);
    case 'SINGLE_CHOICE':
    case 'MULTIPLE_CHOICE':
      return Array.isArray(v.selections) && v.selections.length > 0;
    default:
      return false;
  }
}

/** 최종 제출 검증. 통과하면 ok, 실패하면 사용자 메시지(+첫 오류 문항 id). */
export type CounselingValidation =
  | { ok: true }
  | { ok: false; message: string; questionId?: string };

export function validateSubmit(
  questions: CounselingQuestion[],
  draft: CounselingDraft,
): CounselingValidation {
  for (const q of [...questions].sort((a, b) => a.order_no - b.order_no)) {
    const answered = isAnswered(q, draft);
    if (q.is_required && !answered) {
      return { ok: false, questionId: q.id, message: `필수 항목입니다: ${q.title}` };
    }
    if (!answered) continue;

    if (q.question_type === 'SHORT_ANSWER' || q.question_type === 'LONG_ANSWER') {
      const text = (draft.answers[q.id]?.text ?? '').trim();
      if (text.length > textMaxFor(q.question_type)) {
        return {
          ok: false,
          questionId: q.id,
          message: `${q.title}: ${textMaxFor(q.question_type)}자 이하로 입력해 주세요.`,
        };
      }
    }
    if (q.question_type === 'SINGLE_CHOICE') {
      const sel = draft.answers[q.id]?.selections ?? [];
      if (sel.length !== 1) {
        return { ok: false, questionId: q.id, message: `${q.title}: 하나만 선택해 주세요.` };
      }
    }
  }

  if (draft.followUpRequired && draft.followUpMemo.trim().length === 0) {
    return { ok: false, message: '후속 연계가 필요하면 메모를 입력해 주세요.' };
  }
  return { ok: true };
}

/** 응답된 문항만 v2 RPC 답변 배열로 변환. */
export function toAnswerPayload(
  questions: CounselingQuestion[],
  draft: CounselingDraft,
): CounselingAnswerInput[] {
  const payload: CounselingAnswerInput[] = [];
  for (const q of questions) {
    if (!isAnswered(q, draft)) continue;
    const v = draft.answers[q.id];
    switch (q.question_type) {
      case 'RATING':
        payload.push({ question_id: q.id, answer_rating: v.rating });
        break;
      case 'SHORT_ANSWER':
      case 'LONG_ANSWER':
        payload.push({ question_id: q.id, answer_text: (v.text ?? '').trim() });
        break;
      case 'SINGLE_CHOICE':
      case 'MULTIPLE_CHOICE':
        payload.push({ question_id: q.id, answer_selections: v.selections });
        break;
    }
  }
  return payload;
}

/** v2 임시저장/제출 RPC 파라미터로 변환(답변 배열 + 메타 필드). */
export function toRpcArgsV2(
  slotId: string,
  questions: CounselingQuestion[],
  draft: CounselingDraft,
) {
  const memo = draft.followUpMemo.trim();
  return {
    p_slot_id: slotId,
    p_answers: toAnswerPayload(questions, draft),
    p_follow_up_required: draft.followUpRequired,
    p_follow_up_memo: memo.length > 0 ? memo : null,
    p_is_public: draft.isPublic,
  };
}
