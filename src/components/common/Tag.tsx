import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { BADGE_TONE, type Tone } from '@/lib/tone';

interface CompactTagProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  children: ReactNode;
}

interface CompactTagButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  active?: boolean;
  children: ReactNode;
}

interface DotTagProps extends HTMLAttributes<HTMLSpanElement> {
  dotClassName: string;
  children: ReactNode;
}

export function CompactTag({
  tone = 'neutral',
  children,
  className = '',
  ...rest
}: CompactTagProps) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md border px-1.5 py-1 text-[10px] font-bold leading-none ${BADGE_TONE[tone]} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}

export function CompactTagButton({
  tone = 'neutral',
  active = false,
  children,
  className = '',
  disabled,
  ...rest
}: CompactTagButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled || active}
      className={`inline-flex items-center justify-center rounded-md border px-1.5 py-1 text-[10px] font-bold leading-none transition-colors disabled:cursor-default ${
        active
          ? `${BADGE_TONE[tone]} ring-1 ring-inset ring-current`
          : 'border-border bg-surface-raised text-neutral-base/70 hover:bg-surface disabled:opacity-50'
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function DotTag({ dotClassName, children, className = '', ...rest }: DotTagProps) {
  return (
    <span
      className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-raised px-2 text-xs ${className}`}
      {...rest}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClassName}`} aria-hidden />
      {children}
    </span>
  );
}
