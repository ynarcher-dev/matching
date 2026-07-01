/**
 * 만족도 조사(동적 문항) 순수 함수.
 * 출처: docs/survey_customization_ideation.md §4 (참가자 응답·유효성).
 * 컴포넌트는 문항 정의(SurveyQuestion[])를 받아 이 헬퍼로 검증/페이로드를 만든다.
 */

import type {
  SurveyAnswerInput,
  SurveyDraft,
  SurveyQuestion,
  SurveyQuestionType,
} from '@/types/satisfaction';

/** 주관식(단답/서술) 최대 길이. */
export const SHORT_ANSWER_MAX = 200;
export const LONG_ANSWER_MAX = 1000;

/** 평점 척도(1~5). */
export const RATING_SCALE: number[] = [1, 2, 3, 4, 5];

/** 유형별 한글 라벨(보조 표기용). */
export const QUESTION_TYPE_LABEL: Record<SurveyQuestionType, string> = {
  SINGLE_CHOICE: '객관식(단일 선택)',
  MULTIPLE_CHOICE: '객관식(복수 선택)',
  SHORT_ANSWER: '주관식(단답)',
  LONG_ANSWER: '주관식(서술)',
  RATING: '평점(1~5)',
};

/** 주관식 유형별 최대 길이. */
export function textMaxFor(type: SurveyQuestionType): number {
  return type === 'SHORT_ANSWER' ? SHORT_ANSWER_MAX : LONG_ANSWER_MAX;
}

/** 1~5 사이의 정수 평점인가. */
export function isValidRating(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

/** 한 문항에 대한 draft 입력이 "응답됨"으로 볼 수 있는가. */
export function isAnswered(q: SurveyQuestion, draft: SurveyDraft): boolean {
  const v = draft[q.id];
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

/** 검증 결과: 첫 오류 문항 id + 메시지, 통과 시 RPC 페이로드. */
export type SurveyValidation =
  | { ok: true; payload: SurveyAnswerInput[] }
  | { ok: false; questionId: string; message: string };

/**
 * 문항 정의 + draft 를 클라이언트에서 검증하고 RPC 페이로드를 만든다.
 * (서버 submit_survey 가 권위 — 여기서는 사용자 안내·요청 절감을 위한 1차 검증)
 */
export function validateSurvey(
  questions: SurveyQuestion[],
  draft: SurveyDraft,
): SurveyValidation {
  const payload: SurveyAnswerInput[] = [];

  for (const q of [...questions].sort((a, b) => a.order_no - b.order_no)) {
    const answered = isAnswered(q, draft);

    if (q.is_required && !answered) {
      return { ok: false, questionId: q.id, message: `${q.title} 문항에 응답해 주세요.` };
    }
    if (!answered) continue;

    const v = draft[q.id];
    switch (q.question_type) {
      case 'RATING':
        payload.push({ question_id: q.id, answer_rating: v.rating });
        break;
      case 'SHORT_ANSWER':
      case 'LONG_ANSWER': {
        const text = (v.text ?? '').trim();
        if (text.length > textMaxFor(q.question_type)) {
          return {
            ok: false,
            questionId: q.id,
            message: `${q.title}: ${textMaxFor(q.question_type)}자 이하로 입력해 주세요.`,
          };
        }
        payload.push({ question_id: q.id, answer_text: text });
        break;
      }
      case 'SINGLE_CHOICE':
      case 'MULTIPLE_CHOICE': {
        const sel = v.selections ?? [];
        if (q.question_type === 'SINGLE_CHOICE' && sel.length !== 1) {
          return {
            ok: false,
            questionId: q.id,
            message: `${q.title} 문항은 하나만 선택할 수 있습니다.`,
          };
        }
        const options = q.options ?? [];
        if (sel.some((s) => !options.includes(s))) {
          return { ok: false, questionId: q.id, message: `${q.title}: 잘못된 선택지입니다.` };
        }
        payload.push({ question_id: q.id, answer_selections: sel });
        break;
      }
    }
  }

  return { ok: true, payload };
}
