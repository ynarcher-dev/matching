/**
 * 전문가 상담일지(동적 문항) 도메인 타입.
 * 출처: docs/counseling_log_customization.md §4.
 * 전문가도 OTP 커스텀 JWT 경로이므로 조회/RPC 는 participantClient 를 쓴다(관리자 빌더만 operator).
 */

/** 문항 유형 5종(만족도와 동일 집합). */
export type CounselingQuestionType =
  | 'SINGLE_CHOICE'
  | 'MULTIPLE_CHOICE'
  | 'SHORT_ANSWER'
  | 'LONG_ANSWER'
  | 'RATING';

/** counseling_log_questions 한 행(상담일지 폼 렌더용). */
export interface CounselingQuestion {
  id: string;
  event_id: string;
  question_type: CounselingQuestionType;
  title: string;
  description: string | null;
  options: string[] | null;
  is_required: boolean;
  order_no: number;
  /** 기본 템플릿/레거시 컬럼 매핑 식별자(score_technology … content). NULL = 순수 커스텀 문항. */
  system_key: string | null;
}

/** counseling_log_answers 한 행(작성분 조회용). */
export interface CounselingAnswerRow {
  question_id: string;
  answer_text: string | null;
  answer_rating: number | null;
  answer_selections: string[] | null;
}

/** v2 RPC 로 보낼 답변 1건(문항별, 미응답이면 배열에서 제외). */
export interface CounselingAnswerInput {
  question_id: string;
  answer_rating?: number | null;
  answer_text?: string | null;
  answer_selections?: string[] | null;
}

/** 관리자 빌더 — 문항 생성/수정 입력(서버 컬럼 매핑 전 폼 결과). */
export interface CounselingQuestionInput {
  question_type: CounselingQuestionType;
  title: string;
  description: string | null;
  options: string[] | null;
  is_required: boolean;
  order_no: number;
}
