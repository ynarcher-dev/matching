import { describe, it, expect } from 'vitest';
import {
  canEditCounseling,
  cleanOptions,
  defaultTemplate,
  editLockReason,
  needsOptions,
  nextOrderNo,
} from '@/lib/counselingBuilder';
import { answerToDisplay, ratingAverage } from '@/lib/counselingReport';
import type { CounselingAnswerRow, CounselingQuestion } from '@/types/counselingLog';

function q(partial: Partial<CounselingQuestion> & Pick<CounselingQuestion, 'id' | 'order_no'>): CounselingQuestion {
  return {
    event_id: 'E1',
    question_type: 'RATING',
    title: '문항',
    description: null,
    options: null,
    is_required: true,
    system_key: null,
    ...partial,
  };
}

describe('needsOptions', () => {
  it('객관식만 선택지 필요', () => {
    expect(needsOptions('SINGLE_CHOICE')).toBe(true);
    expect(needsOptions('MULTIPLE_CHOICE')).toBe(true);
    expect(needsOptions('RATING')).toBe(false);
    expect(needsOptions('LONG_ANSWER')).toBe(false);
  });
});

describe('canEditCounseling / editLockReason', () => {
  it('편집 가능 단계 + 답변 0건이면 편집 가능', () => {
    expect(canEditCounseling('DRAFT', 0)).toBe(true);
    expect(canEditCounseling('BOOKING', 0)).toBe(true);
    expect(canEditCounseling('ALLOCATION', 0)).toBe(true);
    expect(editLockReason('DRAFT', 0)).toBeNull();
  });
  it('답변이 1건이라도 있으면 잠금', () => {
    expect(canEditCounseling('DRAFT', 1)).toBe(false);
    expect(editLockReason('DRAFT', 1)).toContain('이미 작성된');
  });
  it('PROGRESS/FINISHED/CANCELLED 는 잠금', () => {
    expect(canEditCounseling('PROGRESS', 0)).toBe(false);
    expect(editLockReason('PROGRESS', 0)).toContain('진행/종료');
    expect(editLockReason('CANCELLED', 0)).toContain('취소된');
  });
});

describe('nextOrderNo', () => {
  it('빈 목록이면 1', () => {
    expect(nextOrderNo([])).toBe(1);
  });
  it('최대 order_no + 1', () => {
    expect(nextOrderNo([q({ id: 'a', order_no: 2 }), q({ id: 'b', order_no: 5 })])).toBe(6);
  });
});

describe('cleanOptions', () => {
  it('공백 trim + 빈 항목 제거', () => {
    expect(cleanOptions([' 시드 ', '', '  ', '시리즈A'])).toEqual(['시드', '시리즈A']);
  });
});

describe('defaultTemplate', () => {
  it('5점 + 의견 = 6문항, 의견만 선택', () => {
    const t = defaultTemplate();
    expect(t).toHaveLength(6);
    expect(t.filter((x) => x.question_type === 'RATING')).toHaveLength(5);
    expect(t[5].question_type).toBe('LONG_ANSWER');
    expect(t[5].is_required).toBe(false);
  });
});

describe('answerToDisplay', () => {
  const rating = q({ id: 'r', order_no: 1, question_type: 'RATING' });
  const choice = q({ id: 'c', order_no: 2, question_type: 'MULTIPLE_CHOICE', options: ['A', 'B'] });
  const text = q({ id: 't', order_no: 3, question_type: 'LONG_ANSWER' });
  function ans(partial: Partial<CounselingAnswerRow>): CounselingAnswerRow {
    return { question_id: 'x', answer_text: null, answer_rating: null, answer_selections: null, ...partial };
  }
  it('답변 없으면 빈 문자열', () => {
    expect(answerToDisplay(rating, undefined)).toBe('');
  });
  it('평점은 숫자 문자열', () => {
    expect(answerToDisplay(rating, ans({ answer_rating: 4 }))).toBe('4');
  });
  it('복수 선택은 콤마 결합', () => {
    expect(answerToDisplay(choice, ans({ answer_selections: ['A', 'B'] }))).toBe('A, B');
  });
  it('주관식은 trim 텍스트', () => {
    expect(answerToDisplay(text, ans({ answer_text: '  메모  ' }))).toBe('메모');
  });
});

describe('ratingAverage', () => {
  it('유효 평점 평균(소수 둘째 자리)', () => {
    const rows: CounselingAnswerRow[] = [
      { question_id: 'r', answer_text: null, answer_rating: 4, answer_selections: null },
      { question_id: 'r', answer_text: null, answer_rating: 5, answer_selections: null },
      { question_id: 'r', answer_text: null, answer_rating: 2, answer_selections: null },
    ];
    expect(ratingAverage(rows)).toBe(3.67);
  });
  it('응답 없으면 null', () => {
    expect(ratingAverage([])).toBeNull();
  });
});
