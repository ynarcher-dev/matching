/**
 * 만족도 조사(동적 문항)·공개 상담 코멘트 도메인 타입.
 * 출처: docs/survey_customization_ideation.md §2 (survey_questions/responses/answers).
 * 참가자(STARTUP) 커스텀 JWT 경로에서 쓰는 행 모델.
 */

/** 문항 유형 5종. */
export type SurveyQuestionType =
  | 'SINGLE_CHOICE'
  | 'MULTIPLE_CHOICE'
  | 'SHORT_ANSWER'
  | 'LONG_ANSWER'
  | 'RATING';

/** 문항 대상 역할. */
export type SurveyTargetRole = 'STARTUP' | 'EXPERT' | 'ALL';

/**
 * 설문 스코프 (8-G).
 * - EVENT : 행사 전체 만족도(행사당 1회). - EXPERT : 전문가별 만족도(상담 슬롯당 1회).
 */
export type SurveyScope = 'EVENT' | 'EXPERT';

/** survey_questions 한 행(설문 렌더용). */
export interface SurveyQuestion {
  id: string;
  event_id: string;
  survey_scope: SurveyScope;
  target_role: SurveyTargetRole;
  question_type: SurveyQuestionType;
  title: string;
  description: string | null;
  options: string[] | null;
  is_required: boolean;
  order_no: number;
}

/** survey_answers 한 행(본인 제출분 조회용). */
export interface SurveyAnswerRow {
  question_id: string;
  answer_text: string | null;
  answer_rating: number | null;
  answer_selections: string[] | null;
}

/** 본인이 제출한 설문(마스터 + 답변). 미제출이면 null. */
export interface MySurveyResponse {
  id: string;
  event_id: string;
  submitted_at: string;
  answers: SurveyAnswerRow[];
}

/** submit_survey RPC 로 보낼 답변 1건(문항별, 미응답이면 배열에서 제외). */
export interface SurveyAnswerInput {
  question_id: string;
  answer_rating?: number | null;
  answer_text?: string | null;
  answer_selections?: string[] | null;
}

/** 폼 작성 중 임시 상태(문항 id → 입력값). */
export type SurveyDraft = Record<
  string,
  { rating?: number; text?: string; selections?: string[] }
>;

/** 관리자 빌더 — 문항 생성/수정 입력(서버 컬럼 매핑 전 폼 결과). */
export interface SurveyQuestionInput {
  survey_scope: SurveyScope;
  target_role: SurveyTargetRole;
  question_type: SurveyQuestionType;
  title: string;
  description: string | null;
  options: string[] | null;
  is_required: boolean;
  order_no: number;
}

/** 공개 상담 코멘트 1건(list_public_comments RPC 반환 — 점수 제외). */
export interface PublicComment {
  slot_id: string;
  expert_id: string;
  expert_name: string;
  start_time: string;
  content: string;
  submitted_at: string;
}

/**
 * 전문가별 만족도에서 스타트업이 응답할 수 있는 상담 슬롯 1건
 * (list_my_consulted_experts RPC 반환). 취소·노쇼 제외.
 */
export interface ConsultedExpertSlot {
  slot_id: string;
  expert_id: string;
  expert_name: string;
  expert_organization: string | null;
  start_time: string;
  end_time: string;
  session_status: string;
  /** 이 슬롯에 이미 전문가 만족도를 제출했는지. */
  responded: boolean;
}

/** 내가 제출한 전문가 만족도 1건(슬롯 단위, +답변). */
export interface MyExpertSurveyResponse {
  id: string;
  slot_id: string;
  target_expert_id: string;
  submitted_at: string;
  answers: SurveyAnswerRow[];
}
