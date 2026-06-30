import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from '@/components/common/Spinner';

export type IconButtonTone = 'neutral' | 'brand' | 'danger';
export type IconButtonSize = 'sm' | 'md';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 아이콘(ReactNode 또는 텍스트 글리프). */
  icon: ReactNode;
  /** 접근성 레이블(필수 — 아이콘만 있는 버튼). */
  label: string;
  tone?: IconButtonTone;
  size?: IconButtonSize;
  loading?: boolean;
}

const TONE: Record<IconButtonTone, string> = {
  neutral: 'text-neutral-base/70 hover:bg-surface hover:text-neutral-base',
  brand: 'text-brand hover:bg-danger-surface',
  danger: 'text-danger hover:bg-danger-surface',
};

const SIZE: Record<IconButtonSize, string> = {
  sm: 'h-7 w-7 text-sm',
  md: 'h-9 w-9 text-base',
};

/**
 * 아이콘 단독 액션 버튼 (9-B): 닫기·삭제·편집·다운로드·복사 등.
 * 텍스트 라벨이 없으므로 aria-label(label prop)을 강제한다.
 */
export function IconButton({
  icon,
  label,
  tone = 'neutral',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        SIZE[size]
      } ${TONE[tone]} ${className}`}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" /> : icon}
    </button>
  );
}
