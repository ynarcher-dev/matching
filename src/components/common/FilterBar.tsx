import type { ReactNode } from 'react';

/**
 * 데이터 테이블 상단 도구 영역(8-C). 검색 입력 + 필터 칩/셀렉트를
 * 일관된 레이아웃으로 배치한다. 내용은 children 으로 주입.
 */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  );
}

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** 입력창 폭 클래스(기본 max-w-xs). */
  widthClass?: string;
}

/**
 * 표준 검색 입력. 기존 UserListView/EventListView 의 검색 input 스타일을 통일.
 * 디바운스는 useDataTable 쪽에서 처리하므로 여기서는 즉시 onChange.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = '검색',
  widthClass = 'max-w-xs',
}: SearchInputProps) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full ${widthClass} rounded-lg border border-border bg-white px-3 py-2 text-base text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30`}
    />
  );
}

export interface FilterChipsProps<V extends string> {
  value: V;
  options: ReadonlyArray<{ value: V; label: string }>;
  onChange: (value: V) => void;
  /** 접근성 레이블. */
  ariaLabel?: string;
}

/**
 * 세그먼트형 필터 칩(상태/역할 탭 통일). 기존 화면들이 제각각 만들던
 * 탭 버튼을 표준화한다.
 */
export function FilterChips<V extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: FilterChipsProps<V>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-muted p-1"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
              active
                ? 'bg-surface-raised text-brand shadow-sm'
                : 'text-neutral-base/70 hover:text-neutral-base'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
