import { z } from 'zod';
import { cleanOptions, needsOptions, OPTION_MIN } from '@/lib/surveyBuilder';
import type { SurveyQuestionType } from '@/types/satisfaction';

/**
 * 만족도 문항 편집 폼 검증 (관리자 빌더).
 * 객관식이면 선택지 2개 이상·중복 금지, 그 외 유형이면 선택지 무시.
 */
const QUESTION_TYPES: [SurveyQuestionType, ...SurveyQuestionType[]] = [
  'RATING',
  'SINGLE_CHOICE',
  'MULTIPLE_CHOICE',
  'SHORT_ANSWER',
  'LONG_ANSWER',
];

export const questionFormSchema = z
  .object({
    question_type: z.enum(QUESTION_TYPES),
    title: z.string().trim().min(1, '문항 제목을 입력해 주세요.').max(200, '제목은 200자 이하여야 합니다.'),
    description: z.string().trim().max(500, '설명은 500자 이하여야 합니다.').optional(),
    is_required: z.boolean(),
    options: z.array(z.string()).default([]),
  })
  .superRefine((val, ctx) => {
    if (!needsOptions(val.question_type)) return;
    const cleaned = cleanOptions(val.options);
    if (cleaned.length < OPTION_MIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: `선택지를 ${OPTION_MIN}개 이상 입력해 주세요.`,
      });
    }
    if (new Set(cleaned).size !== cleaned.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: '중복된 선택지가 있습니다.',
      });
    }
  });

export type QuestionFormValues = z.infer<typeof questionFormSchema>;
