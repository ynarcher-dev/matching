import { describe, it, expect } from 'vitest';
import {
  canEditSurvey,
  cleanOptions,
  defaultTemplate,
  editLockReason,
  needsOptions,
  nextOrderNo,
} from '@/lib/surveyBuilder';
import { questionFormSchema } from '@/schemas/surveyBuilderSchemas';
import type { SurveyQuestion } from '@/types/satisfaction';

function q(partial: Partial<SurveyQuestion> & Pick<SurveyQuestion, 'id' | 'order_no'>): SurveyQuestion {
  return {
    event_id: 'a0000000-0000-4000-8000-000000000001',
    target_role: 'STARTUP',
    question_type: 'RATING',
    title: '문항',
    description: null,
    options: null,
    is_required: true,
    ...partial,
  };
}

describe('needsOptions', () => {
  it('객관식만 선택지가 필요하다', () => {
    expect(needsOptions('SINGLE_CHOICE')).toBe(true);
    expect(needsOptions('MULTIPLE_CHOICE')).toBe(true);
    expect(needsOptions('RATING')).toBe(false);
    expect(needsOptions('SHORT_ANSWER')).toBe(false);
    expect(needsOptions('LONG_ANSWER')).toBe(false);
  });
});

describe('canEditSurvey / editLockReason', () => {
  it('DRAFT/BOOKING/ALLOCATION + 응답0 이면 편집 가능', () => {
    expect(canEditSurvey('DRAFT', 0)).toBe(true);
    expect(canEditSurvey('BOOKING', 0)).toBe(true);
    expect(canEditSurvey('ALLOCATION', 0)).toBe(true);
    expect(editLockReason('BOOKING', 0)).toBeNull();
  });

  it('응답이 있으면 잠긴다', () => {
    expect(canEditSurvey('BOOKING', 1)).toBe(false);
    expect(editLockReason('BOOKING', 3)).toMatch(/응답/);
  });

  it('PROGRESS/FINISHED/CANCELLED 면 잠긴다', () => {
    expect(canEditSurvey('PROGRESS', 0)).toBe(false);
    expect(canEditSurvey('FINISHED', 0)).toBe(false);
    expect(editLockReason('FINISHED', 0)).toMatch(/진행\/종료/);
    expect(editLockReason('CANCELLED', 0)).toMatch(/취소/);
  });
});

describe('nextOrderNo', () => {
  it('같은 역할 문항 최대 order_no + 1', () => {
    const list = [
      q({ id: '1', order_no: 1 }),
      q({ id: '2', order_no: 2 }),
      q({ id: '3', order_no: 5, target_role: 'EXPERT' }),
    ];
    expect(nextOrderNo(list, 'STARTUP')).toBe(3);
    expect(nextOrderNo(list, 'EXPERT')).toBe(6);
  });

  it('해당 역할 문항이 없으면 1', () => {
    expect(nextOrderNo([], 'STARTUP')).toBe(1);
  });
});

describe('cleanOptions', () => {
  it('공백 제거·빈 항목 제거', () => {
    expect(cleanOptions([' A ', '', 'B', '   '])).toEqual(['A', 'B']);
  });
});

describe('defaultTemplate', () => {
  it('역할별 5개 문항(RATING 4 + LONG_ANSWER 1)', () => {
    const t = defaultTemplate('STARTUP');
    expect(t).toHaveLength(5);
    expect(t.every((x) => x.target_role === 'STARTUP')).toBe(true);
    expect(t.filter((x) => x.question_type === 'RATING')).toHaveLength(4);
    expect(t[4].question_type).toBe('LONG_ANSWER');
    expect(t[4].is_required).toBe(false);
  });
});

describe('questionFormSchema', () => {
  it('평점 문항은 선택지 없이 통과', () => {
    const r = questionFormSchema.safeParse({
      question_type: 'RATING',
      title: '만족도',
      is_required: true,
      options: [],
    });
    expect(r.success).toBe(true);
  });

  it('제목이 비면 실패', () => {
    const r = questionFormSchema.safeParse({
      question_type: 'RATING',
      title: '   ',
      is_required: true,
      options: [],
    });
    expect(r.success).toBe(false);
  });

  it('객관식은 선택지 2개 미만이면 실패', () => {
    const r = questionFormSchema.safeParse({
      question_type: 'SINGLE_CHOICE',
      title: '분야 선택',
      is_required: true,
      options: ['A'],
    });
    expect(r.success).toBe(false);
  });

  it('객관식 선택지 중복이면 실패', () => {
    const r = questionFormSchema.safeParse({
      question_type: 'MULTIPLE_CHOICE',
      title: '관심 분야',
      is_required: true,
      options: ['바이오', '바이오'],
    });
    expect(r.success).toBe(false);
  });

  it('객관식 선택지 2개 이상·중복 없으면 통과', () => {
    const r = questionFormSchema.safeParse({
      question_type: 'SINGLE_CHOICE',
      title: '분야',
      is_required: true,
      options: ['바이오', '핀테크'],
    });
    expect(r.success).toBe(true);
  });
});
