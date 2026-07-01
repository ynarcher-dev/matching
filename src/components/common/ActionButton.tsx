import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from '@/components/common/Spinner';

type ActionButtonTone = 'primary' | 'outline' | 'danger';

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ActionButtonTone;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

const TABLE_TONE: Record<ActionButtonTone, string> = {
  primary:
    'border-brand bg-brand text-white hover:border-brand-hover hover:bg-brand-hover disabled:border-neutral-base/30 disabled:bg-neutral-base/30',
  outline:
    'border-border bg-white text-neutral-base hover:border-neutral-base/30 hover:bg-surface disabled:text-neutral-base/40',
  danger:
    'border-border bg-white text-brand hover:border-danger-border hover:bg-danger-surface disabled:text-brand/40',
};

const SECTION_TONE: Record<ActionButtonTone, string> = {
  primary:
    'border-brand bg-brand text-white hover:border-brand-hover hover:bg-brand-hover disabled:border-neutral-base/30 disabled:bg-neutral-base/30',
  outline:
    'border-border bg-white text-neutral-base hover:border-neutral-base/30 hover:bg-surface disabled:text-neutral-base/40',
  danger:
    'border-danger bg-danger text-white hover:border-danger hover:bg-danger/90 disabled:border-neutral-base/30 disabled:bg-neutral-base/30',
};

export function TableActionButton({
  tone = 'outline',
  loading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  disabled,
  children,
  className = '',
  ...rest
}: ActionButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-bold leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
        TABLE_TONE[tone]
      } ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? <Spinner className="h-3.5 w-3.5" /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
}

export function SectionActionButton({
  tone = 'outline',
  loading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  disabled,
  children,
  className = '',
  ...rest
}: ActionButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-bold leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
        SECTION_TONE[tone]
      } ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
}
