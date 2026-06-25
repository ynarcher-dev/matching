import type { ButtonHTMLAttributes } from 'react';
import { Spinner } from '@/components/common/Spinner';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline';
  loading?: boolean;
}

const VARIANT: Record<NonNullable<ButtonProps['variant']>, string> = {
  // Primary: 브랜드 레드 면, 진회색 외곽선 없음 (page_auth_layout.md §2.1).
  primary:
    'bg-brand text-white hover:bg-brand-hover disabled:bg-neutral-base/40 disabled:cursor-not-allowed',
  // 보조: 1px 중립 경계선.
  outline:
    'border border-border bg-white text-neutral-base hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed',
};

/** 공통 버튼. 핵심 조작은 primary(브랜드 레드), 보조는 outline. */
export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-base font-semibold transition-colors ${VARIANT[variant]} ${className}`}
      {...rest}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}
