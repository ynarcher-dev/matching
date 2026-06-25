import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

/**
 * 라벨·에러를 묶은 입력 필드 (page_auth_layout.md §2.1).
 * 기본 1px 중립 경계선, 포커스 시 브랜드 레드 링/경계선. 오류 시 경계선만 브랜드로.
 * forwardRef 로 react-hook-form register 와 호환.
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, id, className = '', ...rest },
  ref,
) {
  const inputId = id ?? rest.name;
  const borderClass = error
    ? 'border-brand focus:border-brand focus:ring-brand/30'
    : 'border-border focus:border-brand focus:ring-brand/30';
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-semibold text-neutral-base">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        className={`w-full rounded-lg border bg-white px-3 py-2 text-base text-neutral-base outline-none transition-colors focus:ring-2 ${borderClass} ${className}`}
        {...rest}
      />
      {error && <p className="text-sm font-medium text-brand">{error}</p>}
    </div>
  );
});
