import { z } from 'zod';

/**
 * 로그인 폼 검증 (page_auth_layout.md §1.2).
 *
 * 참가자(EXPERT/STARTUP)는 등록된 이메일 또는 휴대전화로 6자리 OTP를 받아 로그인한다.
 *   1단계: 식별자(이메일 또는 휴대전화) 제출 → OTP 요청
 *   2단계: 6자리 OTP 제출 → 검증
 * 운영진(ADMIN/STAFF)은 Supabase Auth(이메일/비밀번호).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 휴대전화: 표시용 하이픈/공백 제거 후 숫자만 남긴다. */
export const normalizePhone = (raw: string): string => raw.replace(/[^0-9]/g, '');

/** OTP: 숫자만 남긴다(공백/하이픈 허용 입력 정규화). */
export const normalizeOtp = (raw: string): string => raw.replace(/[^0-9]/g, '');

export type IdentifierKind = 'email' | 'phone' | 'invalid';

/** 식별자가 이메일인지 휴대전화인지 판별한다(서버 발송 채널 선택과 무관한 클라이언트 형식 검증). */
export function classifyIdentifier(raw: string): IdentifierKind {
  const value = raw.trim();
  if (EMAIL_RE.test(value)) return 'email';
  const digits = normalizePhone(value);
  // 국내 휴대전화 10~11자리(0으로 시작). 형식만 검증하고 실제 등록 여부는 서버가 판정.
  if (/^0\d{9,10}$/.test(digits)) return 'phone';
  return 'invalid';
}

export const otpRequestSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, '등록한 이메일 또는 휴대전화 번호를 입력해 주세요.')
    .refine((v) => classifyIdentifier(v) !== 'invalid', '이메일 또는 휴대전화 번호 형식이 아닙니다.'),
});

export const otpVerifySchema = z.object({
  code: z
    .string()
    .min(1, '인증번호를 입력해 주세요.')
    .transform(normalizeOtp)
    .refine((c) => /^\d{6}$/.test(c), '인증번호는 6자리입니다.'),
});

export const operatorLoginSchema = z.object({
  email: z.string().trim().min(1, '이메일을 입력해 주세요.').email('이메일 형식이 아닙니다.'),
  password: z.string().min(1, '비밀번호를 입력해 주세요.'),
});

export type OtpRequestInput = z.infer<typeof otpRequestSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
export type OperatorLoginInput = z.infer<typeof operatorLoginSchema>;
