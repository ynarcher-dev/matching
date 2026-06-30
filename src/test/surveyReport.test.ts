import { describe, it, expect } from 'vitest';
import {
  aggregateQuestion,
  answerToDisplay,
  responseRate,
  toCsv,
} from '@/lib/surveyReport';
import type { SurveyAnswerRow, SurveyQuestion } from '@/types/satisfaction';

function q(partial: Partial<SurveyQuestion> & Pick<SurveyQuestion, 'id' | 'question_type'>): SurveyQuestion {
  return {
    event_id: 'a0000000-0000-4000-8000-000000000001',
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

function ans(partial: Partial<SurveyAnswerRow> & Pick<SurveyAnswerRow, 'question_id'>): SurveyAnswerRow {
  return { answer_text: null, answer_rating: null, answer_selections: null, ...partial };
}

describe('responseRate', () => {
  it('제출/대상 비율을 반올림', () => {
    expect(responseRate(10, 3)).toEqual({ responded: 3, total: 10, pct: 30 });
    expect(responseRate(3, 2)).toEqual({ responded: 2, total: 3, pct: 67 });
  });
  it('대상 0명이면 0%', () => {
    expect(responseRate(0, 0).pct).toBe(0);
  });
});

describe('aggregateQuestion - RATING', () => {
  const rq = q({ id: 'r1', question_type: 'RATING' });
  it('평균·분포·개수를 집계(범위 밖 무시)', () => {
    const agg = aggregateQuestion(rq, [
      ans({ question_id: 'r1', answer_rating: 5 }),
      ans({ question_id: 'r1', answer_rating: 3 }),
      ans({ question_id: 'r1', answer_rating: 4 }),
      ans({ question_id: 'r1', answer_rating: 9 }), // 무시
    ]);
    if (agg.kind !== 'RATING') throw new Error('kind');
    expect(agg.count).toBe(3);
    expect(agg.average).toBe(4);
    expect(agg.distribution).toEqual([0, 0, 1, 1, 1]); // 1~5점
  });
});

describe('aggregateQuestion - CHOICE', () => {
  it('단일 선택 비율', () => {
    const sq = q({ id: 's1', question_type: 'SINGLE_CHOICE', options: ['A', 'B', 'C'] });
    const agg = aggregateQuestion(sq, [
      ans({ question_id: 's1', answer_selections: ['A'] }),
      ans({ question_id: 's1', answer_selections: ['A'] }),
      ans({ question_id: 's1', answer_selections: ['B'] }),
    ]);
    if (agg.kind !== 'CHOICE') throw new Error('kind');
    expect(agg.responders).toBe(3);
    expect(agg.options.find((o) => o.label === 'A')).toEqual({ label: 'A', count: 2, pct: 67 });
    expect(agg.options.find((o) => o.label === 'C')).toEqual({ label: 'C', count: 0, pct: 0 });
  });

  it('복수 선택은 합이 응답자수를 넘을 수 있다', () => {
    const mq = q({ id: 'm1', question_type: 'MULTIPLE_CHOICE', options: ['바이오', '핀테크'] });
    const agg = aggregateQuestion(mq, [
      ans({ question_id: 'm1', answer_selections: ['바이오', '핀테크'] }),
      ans({ question_id: 'm1', answer_selections: ['바이오'] }),
    ]);
    if (agg.kind !== 'CHOICE') throw new Error('kind');
    expect(agg.multiple).toBe(true);
    expect(agg.responders).toBe(2);
    expect(agg.options.find((o) => o.label === '바이오')?.count).toBe(2);
  });
});

describe('aggregateQuestion - TEXT', () => {
  it('빈 문자열 제외하고 모은다', () => {
    const tq = q({ id: 't1', question_type: 'LONG_ANSWER' });
    const agg = aggregateQuestion(tq, [
      ans({ question_id: 't1', answer_text: '좋았습니다' }),
      ans({ question_id: 't1', answer_text: '   ' }),
      ans({ question_id: 't1', answer_text: '추천해요' }),
    ]);
    if (agg.kind !== 'TEXT') throw new Error('kind');
    expect(agg.answers).toEqual(['좋았습니다', '추천해요']);
  });
});

describe('answerToDisplay', () => {
  it('유형별 표시 문자열', () => {
    expect(answerToDisplay(q({ id: 'r', question_type: 'RATING' }), ans({ question_id: 'r', answer_rating: 4 }))).toBe('4');
    expect(
      answerToDisplay(
        q({ id: 'm', question_type: 'MULTIPLE_CHOICE' }),
        ans({ question_id: 'm', answer_selections: ['A', 'B'] }),
      ),
    ).toBe('A, B');
    expect(answerToDisplay(q({ id: 't', question_type: 'SHORT_ANSWER' }), ans({ question_id: 't', answer_text: '메모' }))).toBe('메모');
    expect(answerToDisplay(q({ id: 'x', question_type: 'RATING' }), undefined)).toBe('');
  });
});

describe('toCsv', () => {
  it('헤더+행을 CRLF 로 연결하고 특수문자를 이스케이프', () => {
    const csv = toCsv(
      ['이름', '의견'],
      [
        ['A사', '좋아요'],
        ['B,사', '줄\n바꿈'],
        ['C사', '따옴표"포함'],
      ],
    );
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('이름,의견');
    expect(lines[1]).toBe('A사,좋아요');
    expect(lines[2]).toBe('"B,사","줄\n바꿈"');
    expect(lines[3]).toBe('C사,"따옴표""포함"');
  });
});
