import { describe, it, expect } from 'vitest';
import {
  draftFromLog,
  emptyDraft,
  isAnswered,
  toAnswerPayload,
  toRpcArgsV2,
  validateSubmit,
} from '@/lib/counseling';
import type { CounselingDraft } from '@/lib/counseling';
import type { CounselingAnswerRow, CounselingQuestion } from '@/types/counselingLog';
import type { CounselingLogRow } from '@/types/expert';

function q(partial: Partial<CounselingQuestion> & Pick<CounselingQuestion, 'id'>): CounselingQuestion {
  return {
    event_id: 'E1',
    question_type: 'RATING',
    title: '문항',
    description: null,
    options: null,
    is_required: true,
    order_no: 1,
    system_key: null,
    ...partial,
  };
}

/** 기본 템플릿과 동일한 5점 + 의견 + 커스텀 객관식 문항 세트. */
const QUESTIONS: CounselingQuestion[] = [
  q({ id: 'q-tech', question_type: 'RATING', title: '기술성', order_no: 1, system_key: 'score_technology' }),
  q({ id: 'q-content', question_type: 'LONG_ANSWER', title: '상담 의견', order_no: 2, is_required: false, system_key: 'content' }),
  q({
    id: 'q-stage',
    question_type: 'SINGLE_CHOICE',
    title: '투자 단계',
    order_no: 3,
    options: ['시드', '시리즈A'],
  }),
];

function log(partial: Partial<CounselingLogRow> = {}): CounselingLogRow {
  return {
    id: 'L1',
    matching_slot_id: 'S1',
    score_technology: 4,
    score_expertise: 5,
    score_reliability: 3,
    score_collaboration: 4,
    score_probability: 2,
    content: '좋은 상담이었습니다.',
    follow_up_required: true,
    follow_up_memo: '추가 미팅 필요',
    is_public: true,
    submitted_at: '2026-07-10T02:00:00.000Z',
    updated_at: null,
    ...partial,
  };
}

describe('emptyDraft', () => {
  it('답변은 빈 객체, 메타는 기본값', () => {
    const d = emptyDraft();
    expect(d.answers).toEqual({});
    expect(d.followUpRequired).toBe(false);
    expect(d.isPublic).toBe(false);
  });
});

describe('draftFromLog', () => {
  it('동적 답변이 있으면 답변을 우선 사용한다', () => {
    const answers: CounselingAnswerRow[] = [
      { question_id: 'q-tech', answer_rating: 5, answer_text: null, answer_selections: null },
      { question_id: 'q-stage', answer_rating: null, answer_text: null, answer_selections: ['시드'] },
    ];
    const d = draftFromLog(QUESTIONS, log(), answers);
    expect(d.answers['q-tech'].rating).toBe(5);
    expect(d.answers['q-stage'].selections).toEqual(['시드']);
    expect(d.followUpRequired).toBe(true);
    expect(d.isPublic).toBe(true);
  });

  it('동적 답변이 없으면 system_key 로 레거시 컬럼을 fallback 으로 읽는다', () => {
    const d = draftFromLog(QUESTIONS, log(), []);
    expect(d.answers['q-tech'].rating).toBe(4); // score_technology
    expect(d.answers['q-content'].text).toBe('좋은 상담이었습니다.'); // content
    expect(d.answers['q-stage']).toBeUndefined(); // 커스텀 문항은 레거시 매핑 없음
  });

  it('log 이 null 이면 빈 답변', () => {
    const d = draftFromLog(QUESTIONS, null, []);
    expect(d.answers).toEqual({});
    expect(d.followUpRequired).toBe(false);
  });
});

describe('isAnswered', () => {
  const draft: CounselingDraft = {
    answers: {
      'q-tech': { rating: 3 },
      'q-content': { text: '  ' },
      'q-stage': { selections: [] },
    },
    followUpRequired: false,
    followUpMemo: '',
    isPublic: false,
  };
  it('유효 평점은 응답됨', () => {
    expect(isAnswered(QUESTIONS[0], draft)).toBe(true);
  });
  it('공백 텍스트는 미응답', () => {
    expect(isAnswered(QUESTIONS[1], draft)).toBe(false);
  });
  it('빈 선택은 미응답', () => {
    expect(isAnswered(QUESTIONS[2], draft)).toBe(false);
  });
});

describe('validateSubmit', () => {
  it('필수 문항 누락 시 실패', () => {
    const r = validateSubmit(QUESTIONS, emptyDraft());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.questionId).toBe('q-tech');
  });

  it('필수(기술성·투자단계) 충족 시 통과', () => {
    const draft: CounselingDraft = {
      answers: { 'q-tech': { rating: 4 }, 'q-stage': { selections: ['시드'] } },
      followUpRequired: false,
      followUpMemo: '',
      isPublic: false,
    };
    expect(validateSubmit(QUESTIONS, draft).ok).toBe(true);
  });

  it('단일 선택에 2개 선택 시 실패', () => {
    const draft: CounselingDraft = {
      answers: { 'q-tech': { rating: 4 }, 'q-stage': { selections: ['시드', '시리즈A'] } },
      followUpRequired: false,
      followUpMemo: '',
      isPublic: false,
    };
    expect(validateSubmit(QUESTIONS, draft).ok).toBe(false);
  });

  it('후속 연계 체크 시 메모 필수', () => {
    const draft: CounselingDraft = {
      answers: { 'q-tech': { rating: 4 }, 'q-stage': { selections: ['시드'] } },
      followUpRequired: true,
      followUpMemo: '   ',
      isPublic: false,
    };
    expect(validateSubmit(QUESTIONS, draft).ok).toBe(false);
  });
});

describe('toAnswerPayload / toRpcArgsV2', () => {
  const draft: CounselingDraft = {
    answers: {
      'q-tech': { rating: 4 },
      'q-content': { text: '  내용  ' },
      'q-stage': { selections: ['시드'] },
    },
    followUpRequired: true,
    followUpMemo: '  메모  ',
    isPublic: true,
  };

  it('응답된 문항만 유형별 키로 변환', () => {
    const payload = toAnswerPayload(QUESTIONS, draft);
    expect(payload).toEqual([
      { question_id: 'q-tech', answer_rating: 4 },
      { question_id: 'q-content', answer_text: '내용' },
      { question_id: 'q-stage', answer_selections: ['시드'] },
    ]);
  });

  it('RPC 인자: 슬롯·답변·메타(메모 trim) 매핑', () => {
    const args = toRpcArgsV2('S1', QUESTIONS, draft);
    expect(args.p_slot_id).toBe('S1');
    expect(args.p_answers).toHaveLength(3);
    expect(args.p_follow_up_required).toBe(true);
    expect(args.p_follow_up_memo).toBe('메모');
    expect(args.p_is_public).toBe(true);
  });

  it('빈 메모는 null', () => {
    const args = toRpcArgsV2('S1', QUESTIONS, emptyDraft());
    expect(args.p_follow_up_memo).toBeNull();
    expect(args.p_answers).toEqual([]);
  });
});
