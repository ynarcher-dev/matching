/**
 * 상담일지 결과 집계·CSV 순수 함수 (관리자 리포트).
 * 출처: docs/counseling_log_customization.md §8.3.
 * 행 기준은 survey_responses 가 아니라 counseling_logs + matching_slots 다.
 * CSV 직렬화는 만족도 리포트의 toCsv 유틸을 재사용한다(범용 문자열 유틸).
 */

import type { CounselingAnswerRow, CounselingQuestion } from '@/types/counselingLog';

export { toCsv } from '@/lib/surveyReport';

/** 답변 1건을 CSV/표시용 문자열로. (복수선택은 ", " 결합) */
export function answerToDisplay(
  q: CounselingQuestion,
  answer: CounselingAnswerRow | undefined,
): string {
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

/** 평점형 문항 평균(응답 없으면 null). 리포트 요약 표기용. */
export function ratingAverage(answers: CounselingAnswerRow[]): number | null {
  let sum = 0;
  let count = 0;
  for (const a of answers) {
    const r = a.answer_rating;
    if (typeof r === 'number' && r >= 1 && r <= 5) {
      sum += r;
      count += 1;
    }
  }
  return count > 0 ? Math.round((sum / count) * 100) / 100 : null;
}
