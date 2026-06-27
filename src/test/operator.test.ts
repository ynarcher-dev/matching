import { describe, it, expect } from 'vitest';
import {
  canDeactivate,
  operatorStatusLabel,
  summarizeOperators,
  superAdminRoleConflict,
  isSuperAdminAssignable,
  PERMISSION_RANK,
} from '@/lib/operator';
import { operatorFormSchema } from '@/schemas/operatorSchemas';
import type { Operator } from '@/types/operator';

function op(partial: Partial<Operator> & Pick<Operator, 'id'>): Operator {
  return {
    email: 'a@b.com',
    name: '홍길동',
    role: 'STAFF',
    is_super_admin: false,
    active: true,
    created_at: '2026-06-01T00:00:00.000Z',
    last_sign_in_at: null,
    assigned_event_count: 0,
    ...partial,
  };
}

describe('superAdminRoleConflict / isSuperAdminAssignable', () => {
  it('최고관리자는 ADMIN 역할에만 허용', () => {
    expect(superAdminRoleConflict('STAFF', true)).toBe(true);
    expect(superAdminRoleConflict('ADMIN', true)).toBe(false);
    expect(superAdminRoleConflict('STAFF', false)).toBe(false);
    expect(isSuperAdminAssignable('ADMIN')).toBe(true);
    expect(isSuperAdminAssignable('STAFF')).toBe(false);
  });
});

describe('canDeactivate', () => {
  it('본인 계정/이미 비활성은 비활성화 불가', () => {
    expect(canDeactivate(op({ id: 'u1' }), 'u2')).toBe(true);
    expect(canDeactivate(op({ id: 'u1' }), 'u1')).toBe(false); // 본인
    expect(canDeactivate(op({ id: 'u1', active: false }), 'u2')).toBe(false); // 이미 비활성
  });
});

describe('operatorStatusLabel', () => {
  it('활성/비활성 라벨', () => {
    expect(operatorStatusLabel(true)).toBe('활성');
    expect(operatorStatusLabel(false)).toBe('비활성');
  });
});

describe('summarizeOperators', () => {
  it('전체/활성/최고관리자/스태프 집계', () => {
    const list = [
      op({ id: '1', role: 'ADMIN', is_super_admin: true, active: true }),
      op({ id: '2', role: 'ADMIN', is_super_admin: true, active: false }), // 비활성 super 는 제외
      op({ id: '3', role: 'STAFF', active: true }),
      op({ id: '4', role: 'STAFF', active: false }),
    ];
    expect(summarizeOperators(list)).toEqual({
      total: 4,
      active: 2,
      superAdmins: 1,
      staff: 2,
    });
  });
});

describe('PERMISSION_RANK', () => {
  it('OWNER 가 가장 강하고 VIEWER 가 가장 약하다', () => {
    expect(PERMISSION_RANK.OWNER).toBeGreaterThan(PERMISSION_RANK.MANAGER);
    expect(PERMISSION_RANK.MANAGER).toBeGreaterThan(PERMISSION_RANK.STAFF);
    expect(PERMISSION_RANK.STAFF).toBeGreaterThan(PERMISSION_RANK.VIEWER);
  });
});

describe('operatorFormSchema', () => {
  const base = {
    email: 'op@example.com',
    name: '관리자',
    role: 'ADMIN' as const,
    is_super_admin: false,
    password_mode: 'temp_password' as const,
    reason: '신규 담당자',
  };

  it('유효한 입력 통과', () => {
    expect(operatorFormSchema.safeParse(base).success).toBe(true);
  });

  it('STAFF 에 최고관리자 체크 시 실패', () => {
    const r = operatorFormSchema.safeParse({ ...base, role: 'STAFF', is_super_admin: true });
    expect(r.success).toBe(false);
  });

  it('사유 누락 시 실패', () => {
    const r = operatorFormSchema.safeParse({ ...base, reason: '   ' });
    expect(r.success).toBe(false);
  });

  it('잘못된 이메일 실패', () => {
    const r = operatorFormSchema.safeParse({ ...base, email: 'not-email' });
    expect(r.success).toBe(false);
  });
});
