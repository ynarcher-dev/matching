import { describe, it, expect } from 'vitest';
import {
  otpRequestSchema,
  otpVerifySchema,
  classifyIdentifier,
  normalizePhone,
  normalizeOtp,
} from '@/schemas/authSchemas';
import { homePathFor, ROLE_NAV } from '@/lib/navigation';
import { displayName } from '@/lib/labels';
import { decodeJwtPayload, isJwtExpired } from '@/lib/participantSession';
import type { AppUser } from '@/types/auth';

describe('authSchemas (OTP)', () => {
  it('normalizePhone: 하이픈/공백 제거 후 숫자만', () => {
    expect(normalizePhone('010-1234-5678')).toBe('01012345678');
    expect(normalizePhone(' 010 1234 5678 ')).toBe('01012345678');
  });

  it('normalizeOtp: 숫자만 남긴다', () => {
    expect(normalizeOtp('12 34-56')).toBe('123456');
  });

  it('classifyIdentifier: 이메일/휴대전화/무효 판별', () => {
    expect(classifyIdentifier('user@example.com')).toBe('email');
    expect(classifyIdentifier('010-1234-5678')).toBe('phone');
    expect(classifyIdentifier('01012345678')).toBe('phone');
    expect(classifyIdentifier('hello')).toBe('invalid');
    expect(classifyIdentifier('123')).toBe('invalid');
  });

  it('otpRequestSchema: 이메일과 휴대전화 모두 허용, 형식 오류는 거부', () => {
    expect(otpRequestSchema.safeParse({ identifier: 'a@b.com' }).success).toBe(true);
    expect(otpRequestSchema.safeParse({ identifier: '010-1234-5678' }).success).toBe(true);
    expect(otpRequestSchema.safeParse({ identifier: '그냥텍스트' }).success).toBe(false);
  });

  it('otpVerifySchema: 표시용 구분자 포함 6자리를 정규화, 그 외 거부', () => {
    expect(otpVerifySchema.parse({ code: '12 34 56' }).code).toBe('123456');
    expect(otpVerifySchema.safeParse({ code: '12345' }).success).toBe(false);
    expect(otpVerifySchema.safeParse({ code: '1234567' }).success).toBe(false);
  });
});

describe('navigation', () => {
  it('역할별 홈 경로', () => {
    expect(homePathFor('ADMIN')).toBe('/admin/events');
    expect(homePathFor('STAFF')).toBe('/staff/check-in');
    expect(homePathFor('EXPERT')).toBe('/expert/dashboard');
    expect(homePathFor('STARTUP')).toBe('/startup/booking');
  });

  it('역할별 메뉴 첫 항목이 홈과 일치', () => {
    (['ADMIN', 'STAFF', 'EXPERT', 'STARTUP'] as const).forEach((role) => {
      expect(ROLE_NAV[role][0].path).toBe(homePathFor(role));
    });
  });
});

describe('labels.displayName', () => {
  const base: AppUser = {
    id: '1',
    email: 'a@b.c',
    name: '홍길동',
    role: 'STARTUP',
    company_name: '와이엔에이',
    representative_name: '홍대표',
    expert_position: null,
    is_super_admin: false,
  };
  it('스타트업: 기업명 + 대표명 + 대표님', () => {
    expect(displayName(base)).toBe('와이엔에이 · 홍대표 대표님');
  });
  it('전문가: 이름 + 직책', () => {
    expect(displayName({ ...base, role: 'EXPERT', expert_position: '심사위원' })).toBe(
      '홍길동 심사위원',
    );
  });
});

describe('participantSession JWT helpers', () => {
  // alg=none 더미 토큰(서명 검증 아님 — payload 디코드/만료 판정만 테스트)
  const make = (payload: object) =>
    `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')}.`;

  it('payload 디코드', () => {
    const t = make({ participant_id: 'u1', exp: 9999999999 });
    expect(decodeJwtPayload(t)?.participant_id).toBe('u1');
  });
  it('exp 가 과거면 만료', () => {
    expect(isJwtExpired(make({ exp: 1 }))).toBe(true);
  });
  it('exp 가 충분히 미래면 유효', () => {
    expect(isJwtExpired(make({ exp: 9999999999 }))).toBe(false);
  });
  it('exp 없으면 만료 간주', () => {
    expect(isJwtExpired(make({ foo: 1 }))).toBe(true);
  });
});
