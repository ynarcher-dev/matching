import { z } from 'zod';

/**
 * 로그인 폼 검증 (page_auth_layout.md §1, free_login_transition.md).
 *
 * 참가자(EXPERT/STARTUP)는 외부 발송에 의존하지 않도록 등록된 "이름 + 휴대전화번호"
 * 정확일치로 로그인한다(2026-06-26 무료 운영 전환). 이름은 공백/대소문자를 정규화하고,
 * 휴대전화는 숫자만 남겨 비교한다. 실제 매칭·계정 존재 여부는 서버가 판정한다.
 * 운영진(ADMIN/STAFF)은 Supabase Auth(이메일/비밀번호).
 */

/** 휴대전화: 표시용 하이픈/공백 제거 후 숫자만 남긴다. */
export const normalizePhone = (raw: string): string => raw.replace(/[^0-9]/g, '');

/** 이름: 모든 공백 제거 + 소문자(서버 normalize_name 과 동일 규칙). */
export const normalizeName = (raw: string): string => raw.replace(/\s/g, '').toLowerCase();

export const participantLoginSchema = z.object({
  name: z.string().trim().min(1, '이름을 입력해 주세요.'),
  phone: z
    .string()
    .min(1, '휴대전화 번호를 입력해 주세요.')
    // 국내 휴대전화 10~11자리(0으로 시작). 형식만 검증하고 등록 여부는 서버가 판정.
    .refine((v) => /^0\d{9,10}$/.test(normalizePhone(v)), '휴대전화 번호 형식이 아닙니다.'),
});

export const operatorLoginSchema = z.object({
  email: z.string().trim().min(1, '이메일을 입력해 주세요.').email('이메일 형식이 아닙니다.'),
  password: z.string().min(1, '비밀번호를 입력해 주세요.'),
});

export type ParticipantLoginInput = z.infer<typeof participantLoginSchema>;
export type OperatorLoginInput = z.infer<typeof operatorLoginSchema>;
