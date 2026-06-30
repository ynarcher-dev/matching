/**
 * 전문가별 만족도 결과 집계 순수 함수 (관리자 리포트, 8-G).
 * 출처: docs/functional_followup_plan.md T6 — "전문가 만족도는 상담 전문가별로 별도 집계".
 * 응답은 상담 슬롯 단위(스타트업이 전문가마다 1회)이므로, 전문가(target_expert_id)로 묶어
 * 문항별 답변을 모은다. 문항 집계 자체는 lib/surveyReport.aggregateQuestion 를 재사용한다.
 */

import type { SurveyAnswerRow } from '@/types/satisfaction';

/** 전문가 만족도 응답 1건(슬롯 단위, +답변). */
export interface ExpertResponse {
  id: string;
  user_id: string;
  target_expert_id: string;
  slot_id: string;
  submitted_at: string;
  answers: SurveyAnswerRow[];
}

/** 전문가 1명에 대한 응답 묶음(집계용). */
export interface ExpertReportGroup {
  expertId: string;
  /** 이 전문가에 대해 제출된 응답(슬롯) 수. */
  responseCount: number;
  /** 문항 id → 이 전문가에 대한 모든 답변(aggregateQuestion 입력). */
  answersByQuestion: Map<string, SurveyAnswerRow[]>;
}

/**
 * 응답을 전문가별로 묶는다. 응답 많은 전문가 우선, 동수면 expertId 오름차순(안정 정렬).
 */
export function groupResponsesByExpert(responses: ExpertResponse[]): ExpertReportGroup[] {
  const byExpert = new Map<string, ExpertReportGroup>();
  for (const r of responses) {
    let g = byExpert.get(r.target_expert_id);
    if (!g) {
      g = { expertId: r.target_expert_id, responseCount: 0, answersByQuestion: new Map() };
      byExpert.set(r.target_expert_id, g);
    }
    g.responseCount += 1;
    for (const a of r.answers) {
      const arr = g.answersByQuestion.get(a.question_id) ?? [];
      arr.push(a);
      g.answersByQuestion.set(a.question_id, arr);
    }
  }
  return [...byExpert.values()].sort(
    (a, b) => b.responseCount - a.responseCount || a.expertId.localeCompare(b.expertId),
  );
}
