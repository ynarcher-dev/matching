import { z } from 'zod';

/**
 * 만족도 조사 제출 페이로드(동적) 검증.
 * 문항별 의미 검증(필수/옵션/단일선택)은 lib/satisfaction.validateSurvey 가,
 * 여기서는 submit_survey RPC 로 보내기 직전 페이로드의 "형태"만 방어적으로 확인한다.
 */
export const surveyAnswerInputSchema = z.object({
  question_id: z.string().uuid(),
  answer_rating: z.number().int().min(1).max(5).nullable().optional(),
  answer_text: z.string().nullable().optional(),
  answer_selections: z.array(z.string()).nullable().optional(),
});

export const surveyAnswersSchema = z.array(surveyAnswerInputSchema);

export type SurveyAnswersPayload = z.infer<typeof surveyAnswersSchema>;
