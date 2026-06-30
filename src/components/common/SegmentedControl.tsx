import type { ReactNode } from 'react';
import { SOLID_TONE, type Tone } from '@/lib/tone';

export interface SegmentOption<V extends string> {
  value: V;
  label: ReactNode;
  /** 활성 시 강조 tone(기본 brand). 출석=success/danger 등 의미 색 지정용. */
  activeTone?: Tone;
  /** 접근성/툴팁 텍스트(label 이 아이콘일 때). */
  title?: string;
  disabled?: boolean;
}

interface SegmentedControlProps<V extends string> {
  value: V;
  options: ReadonlyArray<SegmentOption<V>>;
  onChange: (value: V) => void;
  ariaLabel?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
}

const SIZE: Record<NonNullable<SegmentedControlProps<string>['size']>, string> = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-3 py-2 text-sm',
};

/**
 * 작은 상태/보기 전환 + 출석 선택 세그먼트 (9-B). 한 줄에 붙은 분절 버튼.
 * 활성 분절은 activeTone(기본 brand, 출석=success/danger)로 강조한다.
 * 보기/필터 탭은 Tabs/FilterChips, 큰 영역 전환은 Tabs 를 사용한다.
 */
export function SegmentedControl<V extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  size = 'md',
  disabled = false,
  className = '',
}: SegmentedControlProps<V>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex overflow-hidden rounded-lg border border-border ${className}`}
    >
      {options.map((opt, i) => {
        const active = opt.value === value;
        const segDisabled = disabled || opt.disabled;
        const activeClass = active ? SOLID_TONE[opt.activeTone ?? ('brand' as Tone)] : 'bg-surface-raised text-neutral-base/70';
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={opt.title}
            disabled={segDisabled}
            onClick={() => onChange(opt.value)}
            className={`flex-1 font-semibold transition-colors ${SIZE[size]} ${
              i > 0 ? 'border-l border-border' : ''
            } ${activeClass} ${
              segDisabled ? 'cursor-not-allowed opacity-60' : active ? '' : 'hover:bg-surface'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
