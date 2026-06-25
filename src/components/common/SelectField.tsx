import { forwardRef } from 'react';
import type { SelectHTMLAttributes } from 'react';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  options: SelectOption[];
}

/**
 * 라벨·에러를 묶은 셀렉트 박스 (TextField 와 동일 위계).
 * 기본 1px 중립 경계선, 포커스 시 브랜드 링. forwardRef 로 react-hook-form 호환.
 */
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, error, options, id, className = '', ...rest },
  ref,
) {
  const selectId = id ?? rest.name;
  const borderClass = error ? 'border-brand' : 'border-border';
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={selectId} className="text-sm font-semibold text-neutral-base">
        {label}
      </label>
      <select
        ref={ref}
        id={selectId}
        className={`w-full rounded-lg border bg-white px-3 py-2 text-base text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30 ${borderClass} ${className}`}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="text-sm font-medium text-brand">{error}</p>}
    </div>
  );
});
