/**
 * 상담일지 관리자 빌더 순수 함수.
 * 출처: docs/counseling_log_customization.md §6 (관리자 UI: 상담일지 설정).
 * 문항 유형 메타·옵션 필요 여부·편집 잠금 판정·기본 템플릿을 단일 소스로 둔다.
 * 만족도 빌더(lib/surveyBuilder)와 동일한 사용성을 따르되, 역할 구분이 없고
 * 편집 잠금 사유(응답 발생/PROGRESS 이후)가 상담일지 정책에 맞춰진다.
 */

import type {
  CounselingQuestion,
  CounselingQuestionInput,
  CounselingQuestionType,
} from '@/types/counselingLog';
import type { EventStatus } from '@/types/event';

/** 유형 셀렉터용 목록(순서 = 표시 순서). */
export const QUESTION_TYPE_OPTIONS: { value: CounselingQuestionType; label: string }[] = [
  { value: 'RATING', label: '평점 (1~5점)' },
  { value: 'SINGLE_CHOICE', label: '객관식 (단일 선택)' },
  { value: 'MULTIPLE_CHOICE', label: '객관식 (복수 선택)' },
  { value: 'SHORT_ANSWER', label: '주관식 (단답)' },
  { value: 'LONG_ANSWER', label: '주관식 (서술)' },
];

/** 유형별 한글 라벨(카드 배지용). */
export const QUESTION_TYPE_LABEL: Record<CounselingQuestionType, string> = {
  SINGLE_CHOICE: '객관식(단일 선택)',
  MULTIPLE_CHOICE: '객관식(복수 선택)',
  SHORT_ANSWER: '주관식(단답)',
  LONG_ANSWER: '주관식(서술)',
  RATING: '평점(1~5)',
};

/** 선택지(options)가 필요한 유형인가. */
export function needsOptions(type: CounselingQuestionType): boolean {
  return type === 'SINGLE_CHOICE' || type === 'MULTIPLE_CHOICE';
}

/** 선택지 최소 개수. */
export const OPTION_MIN = 2;

/** 문항 편집(추가/수정/삭제/순서)이 가능한 단계인가.
 *  - 행사 상태가 DRAFT/BOOKING/ALLOCATION 이고
 *  - 아직 상담일지 답변이 1건도 없을 때만 편집 가능(응답 발생/PROGRESS 이후 잠금). */
export function canEditCounseling(status: EventStatus, answerCount: number): boolean {
  const editableStatus = status === 'DRAFT' || status === 'BOOKING' || status === 'ALLOCATION';
  return editableStatus && answerCount === 0;
}

/** 잠금 사유 메시지(편집 불가일 때 안내). null 이면 편집 가능. */
export function editLockReason(status: EventStatus, answerCount: number): string | null {
  if (status === 'CANCELLED') return '취소된 행사입니다. 상담일지 문항을 편집할 수 없습니다.';
  if (answerCount > 0) {
    return '이미 작성된 상담일지 답변이 있어 문항을 편집할 수 없습니다. (응답 정합성 보호)';
  }
  if (status === 'PROGRESS' || status === 'FINISHED') {
    return '행사가 진행/종료 단계로 넘어가 상담일지 문항을 편집할 수 없습니다.';
  }
  return null;
}

/** 문항들 뒤에 새로 붙일 order_no. */
export function nextOrderNo(questions: CounselingQuestion[]): number {
  if (questions.length === 0) return 1;
  return Math.max(...questions.map((q) => q.order_no)) + 1;
}

/** 선택지 배열 정리(공백 제거·빈 항목 제거). */
export function cleanOptions(options: string[]): string[] {
  return options.map((o) => o.trim()).filter((o) => o.length > 0);
}

/** 기본 5점 스코어카드 + 상담 의견 템플릿(빈 행사 복구용). */
export function defaultTemplate(): CounselingQuestionInput[] {
  const base: CounselingQuestionInput[] = [
    { question_type: 'RATING', title: '기술성', description: '보유 기술의 깊이 및 구현 완성도', options: null, is_required: true, order_no: 1 },
    { question_type: 'RATING', title: '전문성', description: '팀 구성 및 전문 분야 역량', options: null, is_required: true, order_no: 2 },
    { question_type: 'RATING', title: '신뢰도', description: '인터뷰 태도 및 커뮤니케이션 성실함', options: null, is_required: true, order_no: 3 },
    { question_type: 'RATING', title: '협업 잠재력', description: '파트너십·후속 연계 가능성', options: null, is_required: true, order_no: 4 },
    { question_type: 'RATING', title: '거래 가능성', description: '단기 내 실질적 비즈니스 매칭 성사 확률', options: null, is_required: true, order_no: 5 },
    { question_type: 'LONG_ANSWER', title: '상담 의견', description: '스타트업의 애로사항과 상담 코칭 요약을 기록해 주세요.', options: null, is_required: false, order_no: 6 },
  ];
  return base;
}
