import type { HTMLAttributes, ReactNode } from 'react';
import { BADGE_TONE, type Tone } from '@/lib/tone';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  children: ReactNode;
  /** 앞에 붙는 아이콘/마커(예: ✓, ▶). */
  icon?: ReactNode;
  /** 글자 크기(기본 xs). 권한 배지 등 더 작게는 '11'. */
  size?: 'xs' | '11';
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<BadgeProps['size']>, string> = {
  xs: 'px-2.5 py-0.5 text-xs',
  '11': 'px-2 py-0.5 text-[11px]',
};

/**
 * 공통 상태/권한/메타 배지 (9-B). 색은 9-A tone map(BADGE_TONE)으로만 지정한다.
 * EventStatusBadge·SessionStatusBadge 등 의미별 배지는 이 컴포넌트를 감싸 라벨을 매핑한다.
 */
export function Badge({
  tone = 'neutral',
  children,
  icon,
  size = 'xs',
  className = '',
  ...rest
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-semibold ${SIZE_CLASS[size]} ${BADGE_TONE[tone]} ${className}`}
      {...rest}
    >
      {icon != null && <span aria-hidden>{icon}</span>}
      {children}
    </span>
  );
}
