import { describe, it, expect } from 'vitest';
import {
  effectiveEventPermission,
  canManageEvent,
  canStaffEvent,
  canViewEvent,
  hasCapability,
} from '@/lib/eventPermission';
import type { AppUser } from '@/types/auth';

function user(partial: Partial<Pick<AppUser, 'role' | 'is_super_admin'>>): Pick<AppUser, 'role' | 'is_super_admin'> {
  return { role: 'ADMIN', is_super_admin: false, ...partial };
}

describe('effectiveEventPermission', () => {
  it('최고관리자는 배정과 무관하게 전 행사 OWNER 상당', () => {
    expect(effectiveEventPermission(user({ is_super_admin: true }), null)).toBe('OWNER');
    expect(effectiveEventPermission(user({ is_super_admin: true }), 'VIEWER')).toBe('OWNER');
  });

  it('일반 운영자는 배정된 권한을, 미배정은 null', () => {
    expect(effectiveEventPermission(user({}), 'MANAGER')).toBe('MANAGER');
    expect(effectiveEventPermission(user({}), null)).toBeNull();
    expect(effectiveEventPermission(user({}), undefined)).toBeNull();
  });

  it('비로그인은 null', () => {
    expect(effectiveEventPermission(null, 'OWNER')).toBeNull();
  });

  it('STAFF 역할도 배정 권한을 그대로 따른다(super 아님)', () => {
    expect(effectiveEventPermission(user({ role: 'STAFF' }), 'STAFF')).toBe('STAFF');
  });
});

describe('canManageEvent / canStaffEvent / canViewEvent', () => {
  it('manage = OWNER/MANAGER', () => {
    expect(canManageEvent('OWNER')).toBe(true);
    expect(canManageEvent('MANAGER')).toBe(true);
    expect(canManageEvent('STAFF')).toBe(false);
    expect(canManageEvent('VIEWER')).toBe(false);
    expect(canManageEvent(null)).toBe(false);
  });

  it('staff = OWNER/MANAGER/STAFF (manage 보다 넓다)', () => {
    expect(canStaffEvent('OWNER')).toBe(true);
    expect(canStaffEvent('MANAGER')).toBe(true);
    expect(canStaffEvent('STAFF')).toBe(true);
    expect(canStaffEvent('VIEWER')).toBe(false);
    expect(canStaffEvent(null)).toBe(false);
  });

  it('view = 전체 등급', () => {
    expect(canViewEvent('VIEWER')).toBe(true);
    expect(canViewEvent('STAFF')).toBe(true);
    expect(canViewEvent(null)).toBe(false);
  });
});

describe('hasCapability', () => {
  it('능력 수준별 단일 판정', () => {
    expect(hasCapability('MANAGER', 'manage')).toBe(true);
    expect(hasCapability('STAFF', 'manage')).toBe(false);
    expect(hasCapability('STAFF', 'staff')).toBe(true);
    expect(hasCapability('VIEWER', 'staff')).toBe(false);
    expect(hasCapability('VIEWER', 'view')).toBe(true);
    expect(hasCapability(null, 'view')).toBe(false);
  });
});
