import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ChoiceChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  children: ReactNode;
  shape?: 'pill' | 'box';
}

export function ChoiceChip({
  selected = false,
  children,
  shape = 'box',
  className = '',
  disabled,
  ...rest
}: ChoiceChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      className={`inline-flex h-7 items-center justify-center border px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        shape === 'pill' ? 'rounded-full' : 'rounded-md'
      } ${
        selected
          ? 'border-brand bg-surface-raised text-brand'
          : 'border-transparent bg-transparent text-neutral-base/70 hover:text-neutral-base'
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function MultiChoiceChip({
  selected = false,
  children,
  className = '',
  disabled,
  ...rest
}: ChoiceChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      className={`inline-flex h-7 items-center justify-center rounded-full border px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        selected
          ? 'border-brand bg-brand text-white'
          : 'border-border bg-surface-raised text-neutral-base hover:bg-surface'
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
