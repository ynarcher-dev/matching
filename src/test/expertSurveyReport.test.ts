import { describe, it, expect } from 'vitest';
import { groupResponsesByExpert, type ExpertResponse } from '@/lib/expertSurveyReport';
import type { SurveyAnswerRow } from '@/types/satisfaction';

function ans(question_id: string, rating: number): SurveyAnswerRow {
  return { question_id, answer_text: null, answer_rating: rating, answer_selections: null };
}

function resp(
  id: string,
  expertId: string,
  slotId: string,
  answers: SurveyAnswerRow[],
): ExpertResponse {
  return {
    id,
    user_id: `startup-${id}`,
    target_expert_id: expertId,
    slot_id: slotId,
    submitted_at: '2026-06-28T00:00:00Z',
    answers,
  };
}

describe('groupResponsesByExpert', () => {
  it('빈 입력은 빈 배열', () => {
    expect(groupResponsesByExpert([])).toEqual([]);
  });

  it('전문가별로 응답을 묶고 슬롯 수를 센다', () => {
    const groups = groupResponsesByExpert([
      resp('1', 'expA', 's1', [ans('q1', 5)]),
      resp('2', 'expA', 's2', [ans('q1', 3)]),
      resp('3', 'expB', 's3', [ans('q1', 4)]),
    ]);
    expect(groups).toHaveLength(2);
    const a = groups.find((g) => g.expertId === 'expA')!;
    expect(a.responseCount).toBe(2);
    expect(a.answersByQuestion.get('q1')).toHaveLength(2);
    const b = groups.find((g) => g.expertId === 'expB')!;
    expect(b.responseCount).toBe(1);
  });

  it('응답 많은 전문가 우선, 동수면 expertId 오름차순 정렬', () => {
    const groups = groupResponsesByExpert([
      resp('1', 'expB', 's1', [ans('q1', 5)]),
      resp('2', 'expB', 's2', [ans('q1', 5)]),
      resp('3', 'expA', 's3', [ans('q1', 4)]),
      resp('4', 'expC', 's4', [ans('q1', 4)]),
    ]);
    // expB(2건) 먼저, 그 다음 동수(1건)는 expA < expC.
    expect(groups.map((g) => g.expertId)).toEqual(['expB', 'expA', 'expC']);
  });

  it('한 문항의 답변을 전문가 단위로 모은다(집계 입력용)', () => {
    const groups = groupResponsesByExpert([
      resp('1', 'expA', 's1', [ans('q1', 5), ans('q2', 4)]),
      resp('2', 'expA', 's2', [ans('q1', 3), ans('q2', 2)]),
    ]);
    const a = groups[0];
    expect(a.answersByQuestion.get('q1')!.map((x) => x.answer_rating)).toEqual([5, 3]);
    expect(a.answersByQuestion.get('q2')!.map((x) => x.answer_rating)).toEqual([4, 2]);
  });
});
