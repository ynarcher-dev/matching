import { z } from 'zod';
import { normalizePhone } from '@/schemas/authSchemas';

/**
 * 참가자 개별 등록/수정 폼 검증 (page_admin_user_management.md §1.2, §2.4).
 * 필수값은 이름·이메일·역할(§2.2). 연락처는 선택이나 입력 시 형식 검증.
 * 분야(field_ids)는 최대 3개. 소개서/프로필 파일(File)은 폼 밖 상태로 다룬다(zod 비대상).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 선택 텍스트: 공백만이면 빈 문자열로 정규화(저장 시 null 처리). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max}자 이하로 입력해 주세요.`)
    .optional()
    .or(z.literal(''));

/** 휴대전화(선택): 입력 시 국내 휴대전화 형식만 허용. */
const phoneField = z
  .string()
  .trim()
  .optional()
  .or(z.literal(''))
  .refine(
    (v) => !v || /^0\d{9,10}$/.test(normalizePhone(v)),
    '휴대전화 번호 형식이 아닙니다.',
  );

export const participantFormSchema = z.object({
  role: z.enum(['EXPERT', 'STARTUP'], { required_error: '역할을 선택해 주세요.' }),
  name: z.string().trim().min(1, '이름을 입력해 주세요.').max(100, '이름은 100자 이하여야 합니다.'),
  email: z
    .string()
    .trim()
    .min(1, '이메일을 입력해 주세요.')
    .max(255, '이메일은 255자 이하여야 합니다.')
    .refine((v) => EMAIL_RE.test(v), '이메일 형식이 아닙니다.'),
  phone_number: phoneField,
  // 스타트업 전용
  company_name: optionalText(255),
  representative_name: optionalText(100),
  contact_name: optionalText(100),
  company_homepage: optionalText(255),
  company_description: optionalText(2000),
  // 전문가 전용
  expert_organization: optionalText(255),
  expert_position: optionalText(100),
  expert_description: optionalText(2000),
  // 관심/전문 분야(M:N) — field_id 목록, 최대 3개(DB 트리거와 정합).
  field_ids: z
    .array(z.string().uuid())
    .max(3, '분야는 최대 3개까지 선택할 수 있습니다.')
    .default([]),
});

export type ParticipantFormValues = z.infer<typeof participantFormSchema>;

/** 세션 무효화·긴급 로그인 링크 발급 등 사유 필수 액션 공통 스키마. */
export const reasonSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, '사유를 입력해 주세요.')
    .max(500, '사유는 500자 이하여야 합니다.'),
});

export type ReasonValues = z.infer<typeof reasonSchema>;
