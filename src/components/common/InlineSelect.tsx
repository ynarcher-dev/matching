import type { SelectHTMLAttributes } from 'react';

interface InlineSelectOption {
  value: string;
  label: string;
}

interface InlineSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: InlineSelectOption[];
  /** 접근성 레이블(테이블 셀 등 라벨이 없는 위치). */
  ariaLabel: string;
}

/**
 * 테이블 행/셀 안의 작은 select (9-B). 라벨·에러 없는 컴팩트형.
 * 라벨이 필요한 폼 셀렉트는 SelectField, 옵션이 길면 SearchableSelect 를 사용한다.
 */
export function InlineSelect({ options, ariaLabel, className = '', ...rest }: InlineSelectProps) {
  return (
    <select
      aria-label={ariaLabel}
      className={`h-7 rounded-md border border-border bg-surface-raised px-2 text-sm text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...rest}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
