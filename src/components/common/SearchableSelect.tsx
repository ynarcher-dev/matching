import { useEffect, useMemo, useRef, useState } from 'react';

export interface SearchableOption {
  value: string;
  label: string;
  /** 검색 대상 보조 텍스트(소속·연락처 등). */
  keywords?: string;
}

interface SearchableSelectProps {
  options: SearchableOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  /** 검색 입력 placeholder. */
  searchPlaceholder?: string;
  disabled?: boolean;
  emptyMessage?: string;
  className?: string;
}

/**
 * 긴 옵션 목록용 검색형 단일 선택 (9-B). 후보/운영자/스타트업 등 목록이 길 때 사용.
 * 옵션이 적으면 SelectField, 다중 선택은 MultiSelectChips 를 사용한다.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = '선택',
  searchPlaceholder = '검색',
  disabled = false,
  emptyMessage = '결과 없음',
  className = '',
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) || (o.keywords ?? '').toLowerCase().includes(q),
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-left text-base text-neutral-base outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={selected ? '' : 'text-neutral-base/50'}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="text-xs text-neutral-base/40" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface-raised shadow-md">
          <div className="border-b border-border p-2">
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full rounded-md border border-border bg-surface-raised px-2 py-1.5 text-sm text-neutral-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <ul role="listbox" className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-neutral-base/50">{emptyMessage}</li>
            ) : (
              filtered.map((o) => {
                const isSelected = o.value === value;
                return (
                  <li key={o.value} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(o.value);
                        setOpen(false);
                      }}
                      className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface ${
                        isSelected ? 'font-semibold text-brand' : 'text-neutral-base'
                      }`}
                    >
                      {o.label}
                      {o.keywords && (
                        <span className="ml-1 text-xs text-neutral-base/50">{o.keywords}</span>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
