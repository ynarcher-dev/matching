/**
 * 만족도 조사 결과 집계·CSV 순수 함수 (관리자 리포트).
 * 출처: docs/survey_customization_ideation.md §3.2, §5.
 * 컴포넌트는 응답 행을 모아 이 헬퍼로 집계/CSV 문자열을 만든다(렌더·다운로드만 담당).
 */

import { sanitizeCell } from '@/lib/exportSafety';
import type { SurveyAnswerRow, SurveyQuestion } from '@/types/satisfaction';

/** 평점형 집계: 응답 수·평균·1~5 분포(index 0=1점 … 4=5점). */
export interface RatingAgg {
  kind: 'RATING';
  count: number;
  average: number;
  distribution: number[];
}

/** 객관식 집계: 선택지별 응답 수·비율(%). */
export interface ChoiceAgg {
  kind: 'CHOICE';
  multiple: boolean;
  responders: number;
  options: { label: string; count: number; pct: number }[];
}

/** 주관식 집계: 비어있지 않은 응답 텍스트 목록(최신 입력 순서는 호출부 정렬). */
export interface TextAgg {
  kind: 'TEXT';
  answers: string[];
}

export type QuestionAgg = RatingAgg | ChoiceAgg | TextAgg;

/** 응답률 = 제출 인원 / 대상 인원. */
export interface ResponseRate {
  responded: number;
  total: number;
  pct: number;
}

export function responseRate(total: number, responded: number): ResponseRate {
  const pct = total > 0 ? Math.round((responded / total) * 100) : 0;
  return { responded, total, pct };
}

/** 문항 유형 → 집계 종류(평점/선택형/주관식). 결과 리포트의 유형 필터·그룹화 공용. */
export function questionKind(questionType: SurveyQuestion['question_type']): QuestionAgg['kind'] {
  if (questionType === 'RATING') return 'RATING';
  if (questionType === 'SINGLE_CHOICE' || questionType === 'MULTIPLE_CHOICE') return 'CHOICE';
  return 'TEXT';
}

/** 결과 리포트 상단 유형 필터 칩(평점/선택형/주관식). */
export type QuestionKindFilter = 'ALL' | QuestionAgg['kind'];
export const QUESTION_KIND_FILTERS: ReadonlyArray<{ value: QuestionKindFilter; label: string }> = [
  { value: 'ALL', label: '전체' },
  { value: 'RATING', label: '평점' },
  { value: 'CHOICE', label: '선택형' },
  { value: 'TEXT', label: '주관식' },
];

/** 한 문항의 답변들을 유형에 맞게 집계. */
export function aggregateQuestion(q: SurveyQuestion, answers: SurveyAnswerRow[]): QuestionAgg {
  if (q.question_type === 'RATING') {
    const distribution = [0, 0, 0, 0, 0];
    let sum = 0;
    let count = 0;
    for (const a of answers) {
      const r = a.answer_rating;
      if (typeof r === 'number' && r >= 1 && r <= 5) {
        distribution[r - 1] += 1;
        sum += r;
        count += 1;
      }
    }
    return {
      kind: 'RATING',
      count,
      average: count > 0 ? Math.round((sum / count) * 100) / 100 : 0,
      distribution,
    };
  }

  if (q.question_type === 'SINGLE_CHOICE' || q.question_type === 'MULTIPLE_CHOICE') {
    const options = q.options ?? [];
    const counts = new Map<string, number>(options.map((o) => [o, 0]));
    let responders = 0;
    for (const a of answers) {
      const sel = a.answer_selections;
      if (Array.isArray(sel) && sel.length > 0) {
        responders += 1;
        for (const s of sel) {
          if (counts.has(s)) counts.set(s, (counts.get(s) ?? 0) + 1);
        }
      }
    }
    return {
      kind: 'CHOICE',
      multiple: q.question_type === 'MULTIPLE_CHOICE',
      responders,
      options: options.map((label) => {
        const count = counts.get(label) ?? 0;
        return { label, count, pct: responders > 0 ? Math.round((count / responders) * 100) : 0 };
      }),
    };
  }

  // SHORT_ANSWER / LONG_ANSWER
  const texts = answers.map((a) => (a.answer_text ?? '').trim()).filter((t) => t.length > 0);
  return { kind: 'TEXT', answers: texts };
}

/** 답변 1건을 CSV/표시용 문자열로. (복수선택은 ", " 결합) */
export function answerToDisplay(q: SurveyQuestion, answer: SurveyAnswerRow | undefined): string {
  if (!answer) return '';
  switch (q.question_type) {
    case 'RATING':
      return answer.answer_rating != null ? String(answer.answer_rating) : '';
    case 'SINGLE_CHOICE':
    case 'MULTIPLE_CHOICE':
      return Array.isArray(answer.answer_selections) ? answer.answer_selections.join(', ') : '';
    default:
      return (answer.answer_text ?? '').trim();
  }
}

/**
 * CSV 셀 이스케이프.
 * 1) 수식 인젝션 방어(sanitizeCell): 위험 접두 문자 시작 시 `'` prefix.
 * 2) 쉼표·따옴표·줄바꿈 포함 시 따옴표로 감싸고 내부 따옴표 이중화.
 */
function escapeCsvCell(value: string): string {
  const safe = sanitizeCell(value);
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/** 헤더 + 행렬을 CSV 문자열로(엑셀 한글 호환을 위해 호출부에서 BOM 부착). */
export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(','));
  return lines.join('\r\n');
}
