/**
 * 만족도 조사 관리자 빌더 순수 함수.
 * 출처: docs/survey_customization_ideation.md §3 (관리자 설문조사 빌더).
 * 문항 유형 메타·옵션 필요 여부·편집 잠금 판정·기본 템플릿을 단일 소스로 둔다.
 */

import type {
  SurveyQuestion,
  SurveyQuestionInput,
  SurveyQuestionType,
  SurveyTargetRole,
} from '@/types/satisfaction';
import type { EventStatus } from '@/types/event';

/** 유형 셀렉터용 목록(순서 = 표시 순서). */
export const QUESTION_TYPE_OPTIONS: { value: SurveyQuestionType; label: string }[] = [
  { value: 'RATING', label: '평점 (1~5점)' },
  { value: 'SINGLE_CHOICE', label: '객관식 (단일 선택)' },
  { value: 'MULTIPLE_CHOICE', label: '객관식 (복수 선택)' },
  { value: 'SHORT_ANSWER', label: '주관식 (단답)' },
  { value: 'LONG_ANSWER', label: '주관식 (서술)' },
];

/** 선택지(options)가 필요한 유형인가. */
export function needsOptions(type: SurveyQuestionType): boolean {
  return type === 'SINGLE_CHOICE' || type === 'MULTIPLE_CHOICE';
}

/** 선택지 최소 개수. */
export const OPTION_MIN = 2;

/** 문항 편집(추가/수정/삭제/순서)이 가능한 단계인가.
 *  - 행사 상태가 DRAFT/BOOKING/ALLOCATION 이고
 *  - 아직 응답이 1건도 없을 때만 편집 가능(응답 발생/PROGRESS 이후 잠금). */
export function canEditSurvey(status: EventStatus, responseCount: number): boolean {
  const editableStatus = status === 'DRAFT' || status === 'BOOKING' || status === 'ALLOCATION';
  return editableStatus && responseCount === 0;
}

/** 잠금 사유 메시지(편집 불가일 때 안내). null 이면 편집 가능. */
export function editLockReason(status: EventStatus, responseCount: number): string | null {
  if (status === 'CANCELLED') return '취소된 행사입니다. 설문을 편집할 수 없습니다.';
  if (responseCount > 0) {
    return '이미 제출된 응답이 있어 설문 문항을 편집할 수 없습니다. (응답 정합성 보호)';
  }
  if (status === 'PROGRESS' || status === 'FINISHED') {
    return '행사가 진행/종료 단계로 넘어가 설문 문항을 편집할 수 없습니다.';
  }
  return null;
}

/** 같은 역할(role) 문항들 뒤에 새로 붙일 order_no. */
export function nextOrderNo(questions: SurveyQuestion[], role: SurveyTargetRole): number {
  const same = questions.filter((q) => q.target_role === role);
  if (same.length === 0) return 1;
  return Math.max(...same.map((q) => q.order_no)) + 1;
}

/** 선택지 배열 정리(공백 제거·빈 항목 제거). */
export function cleanOptions(options: string[]): string[] {
  return options.map((o) => o.trim()).filter((o) => o.length > 0);
}

/** 레거시 4점 + 자유의견 기본 템플릿(역할별). */
export function defaultTemplate(role: SurveyTargetRole): SurveyQuestionInput[] {
  const base: Omit<SurveyQuestionInput, 'target_role'>[] = [
    { question_type: 'RATING', title: '행사 전반 만족도', description: '행사 전반에 대해 얼마나 만족하셨나요?', options: null, is_required: true, order_no: 1 },
    { question_type: 'RATING', title: '매칭 적절성', description: '연결된 상대와의 매칭이 적절했나요?', options: null, is_required: true, order_no: 2 },
    { question_type: 'RATING', title: '운영 만족도', description: '행사 운영(안내·진행)에 만족하셨나요?', options: null, is_required: true, order_no: 3 },
    { question_type: 'RATING', title: '재참여 의향', description: '다음에도 참여하실 의향이 있으신가요?', options: null, is_required: true, order_no: 4 },
    { question_type: 'LONG_ANSWER', title: '자유 의견', description: '행사 운영·매칭에 대한 의견을 자유롭게 남겨 주세요.', options: null, is_required: false, order_no: 5 },
  ];
  return base.map((b) => ({ ...b, target_role: role }));
}
