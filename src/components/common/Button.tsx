import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from '@/components/common/Spinner';

export type ButtonVariant = 'primary' | 'outline' | 'danger' | 'ghost' | 'subtle';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** 텍스트 앞 아이콘(ReactNode). loading 중에는 스피너로 대체. */
  leftIcon?: ReactNode;
  /** 텍스트 뒤 아이콘(ReactNode). */
  rightIcon?: ReactNode;
  /** 가로 전체 폭. */
  fullWidth?: boolean;
}

const VARIANT: Record<ButtonVariant, string> = {
  // Primary: 브랜드 레드 면 (page_auth_layout.md §2.1).
  primary:
    'bg-brand text-white hover:bg-brand-hover disabled:bg-neutral-base/40 disabled:cursor-not-allowed',
  // 보조: 1px 중립 경계선.
  outline:
    'border border-border bg-surface-raised text-neutral-base hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed',
  // 위험: 삭제·취소 등 파괴적 조작 (9-A danger tone).
  danger:
    'bg-danger text-white hover:bg-danger/90 disabled:bg-neutral-base/40 disabled:cursor-not-allowed',
  // 약한 보조: 경계선 없는 텍스트 버튼.
  ghost:
    'bg-transparent text-neutral-base hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed',
  // 연한 면: 보조 액션을 면으로 구분(경계선 없음).
  subtle:
    'bg-surface text-neutral-base hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
  lg: 'px-4 py-2 text-base',
};

/**
 * 공통 버튼 (9-B 확장: variant/size/icon/loading).
 * - variant: primary(핵심)·outline(보조)·danger(파괴적)·ghost/subtle(약한 보조)
 * - size: sm/md/lg, 기본 md(기존 스타일과 동일)
 * - leftIcon/rightIcon: 아이콘 액션, loading 시 leftIcon 자리에 스피너
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  disabled,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors ${
        SIZE[size]
      } ${VARIANT[variant]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
}
