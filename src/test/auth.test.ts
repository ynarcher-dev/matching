import { describe, it, expect } from 'vitest';
import {
  participantLoginSchema,
  normalizePhone,
  normalizeName,
} from '@/schemas/authSchemas';
import { homePathFor, ROLE_NAV } from '@/lib/navigation';
import { displayName } from '@/lib/labels';
import { decodeJwtPayload, isJwtExpired } from '@/lib/participantSession';
import type { AppUser } from '@/types/auth';

describe('authSchemas (이름 + 휴대전화 로그인)', () => {
  it('normalizePhone: 하이픈/공백 제거 후 숫자만', () => {
    expect(normalizePhone('010-1234-5678')).toBe('01012345678');
    expect(normalizePhone(' 010 1234 5678 ')).toBe('01012345678');
  });

  it('normalizeName: 모든 공백 제거 + 소문자 (서버 normalize_name 과 동일)', () => {
    expect(normalizeName('홍 길동')).toBe('홍길동');
    expect(normalizeName(' 홍길동 ')).toBe('홍길동');
    expect(normalizeName('John Smith')).toBe('johnsmith');
  });

  it('participantLoginSchema: 이름+휴대전화 정상 입력 허용', () => {
    expect(
      participantLoginSchema.safeParse({ name: '홍길동', phone: '010-1234-5678' }).success,
    ).toBe(true);
    expect(
      participantLoginSchema.safeParse({ name: '홍길동', phone: '01012345678' }).success,
    ).toBe(true);
  });

  it('participantLoginSchema: 이름 누락·전화 형식 오류는 거부', () => {
    expect(participantLoginSchema.safeParse({ name: '', phone: '01012345678' }).success).toBe(
      false,
    );
    expect(participantLoginSchema.safeParse({ name: '홍길동', phone: '12345' }).success).toBe(
      false,
    );
    expect(
      participantLoginSchema.safeParse({ name: '홍길동', phone: '010-1234' }).success,
    ).toBe(false);
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
