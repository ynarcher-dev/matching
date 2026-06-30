import { describe, it, expect } from 'vitest';
import { isAnswered, isValidRating, validateSurvey } from '@/lib/satisfaction';
import { surveyAnswersSchema } from '@/schemas/satisfactionSchemas';
import type { SurveyDraft, SurveyQuestion } from '@/types/satisfaction';

/** 테스트용 문항 빌더(고정 UUID). */
function q(partial: Partial<SurveyQuestion> & Pick<SurveyQuestion, 'id' | 'question_type'>): SurveyQuestion {
  return {
    event_id: 'e0000000-0000-4000-8000-000000000001',
    survey_scope: 'EVENT',
    target_role: 'STARTUP',
    title: '문항',
    description: null,
    options: null,
    is_required: true,
    order_no: 1,
    ...partial,
  };
}

const RATING = q({ id: '11111111-1111-4111-8111-111111111111', question_type: 'RATING', order_no: 1 });
const LONG = q({
  id: '22222222-2222-4222-8222-222222222222',
  question_type: 'LONG_ANSWER',
  is_required: false,
  order_no: 2,
});
const SINGLE = q({
  id: '33333333-3333-4333-8333-333333333333',
  question_type: 'SINGLE_CHOICE',
  options: ['A', 'B', 'C'],
  order_no: 3,
});
const MULTI = q({
  id: '44444444-4444-4444-8444-444444444444',
  question_type: 'MULTIPLE_CHOICE',
  options: ['바이오', '친환경', '핀테크'],
  order_no: 4,
});

describe('isValidRating', () => {
  it('1~5 정수만 통과시킨다', () => {
    expect(isValidRating(1)).toBe(true);
    expect(isValidRating(5)).toBe(true);
    expect(isValidRating(0)).toBe(false);
    expect(isValidRating(6)).toBe(false);
    expect(isValidRating(3.5)).toBe(false);
    expect(isValidRating(null)).toBe(false);
    expect(isValidRating(undefined)).toBe(false);
  });
});

describe('isAnswered', () => {
  it('유형별로 응답 여부를 판정한다', () => {
    expect(isAnswered(RATING, { [RATING.id]: { rating: 4 } })).toBe(true);
    expect(isAnswered(RATING, { [RATING.id]: {} })).toBe(false);
    expect(isAnswered(LONG, { [LONG.id]: { text: '  ' } })).toBe(false);
    expect(isAnswered(LONG, { [LONG.id]: { text: '좋아요' } })).toBe(true);
    expect(isAnswered(SINGLE, { [SINGLE.id]: { selections: [] } })).toBe(false);
    expect(isAnswered(SINGLE, { [SINGLE.id]: { selections: ['A'] } })).toBe(true);
  });
});

describe('validateSurvey', () => {
  it('필수 평점/선택 + 비필수 미응답이면 통과하고 페이로드를 만든다', () => {
    const draft: SurveyDraft = {
      [RATING.id]: { rating: 5 },
      [SINGLE.id]: { selections: ['B'] },
      [MULTI.id]: { selections: ['바이오', '핀테크'] },
    };
    const r = validateSurvey([RATING, LONG, SINGLE, MULTI], draft);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 비필수 LONG 은 미응답이라 페이로드에서 제외
      expect(r.payload).toHaveLength(3);
      expect(r.payload).toContainEqual({ question_id: RATING.id, answer_rating: 5 });
      expect(r.payload).toContainEqual({ question_id: SINGLE.id, answer_selections: ['B'] });
    }
  });

  it('필수 문항 누락이면 실패하고 해당 문항을 가리킨다', () => {
    const r = validateSurvey([RATING], {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.questionId).toBe(RATING.id);
  });

  it('단일 선택에 2개를 고르면 실패한다', () => {
    const r = validateSurvey([SINGLE], { [SINGLE.id]: { selections: ['A', 'B'] } });
    expect(r.ok).toBe(false);
  });

  it('정의되지 않은 선택지면 실패한다', () => {
    const r = validateSurvey([MULTI], { [MULTI.id]: { selections: ['우주항공'] } });
    expect(r.ok).toBe(false);
  });

  it('서술형이 최대 길이를 넘으면 실패한다', () => {
    const required = q({ ...LONG, is_required: true });
    const r = validateSurvey([required], { [required.id]: { text: 'a'.repeat(1001) } });
    expect(r.ok).toBe(false);
  });
});

describe('surveyAnswersSchema', () => {
  it('정상 페이로드 형태를 통과시킨다', () => {
    const parsed = surveyAnswersSchema.safeParse([
      { question_id: RATING.id, answer_rating: 4 },
      { question_id: SINGLE.id, answer_selections: ['A'] },
    ]);
    expect(parsed.success).toBe(true);
  });

  it('잘못된 평점 범위는 막는다', () => {
    const parsed = surveyAnswersSchema.safeParse([{ question_id: RATING.id, answer_rating: 9 }]);
    expect(parsed.success).toBe(false);
  });
});
