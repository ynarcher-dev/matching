export interface ChipOption {
  value: string;
  label: string;
}

interface MultiSelectChipsProps {
  /** 선택지. */
  options: ChipOption[];
  /** 선택된 value 목록. */
  value: string[];
  onChange: (next: string[]) => void;
  /** 최대 선택 개수(도달 시 미선택 칩 비활성). 미지정=무제한. */
  max?: number;
  /** 로딩/에러/오류 메시지(선택). */
  loading?: boolean;
  error?: string;
  /** 옵션이 비어있을 때 안내. */
  emptyMessage?: string;
}

/**
 * 칩 토글 기반 다중 선택 (9-B). 분야·후보·객관식 옵션 등 일반화.
 * 기존 FieldMultiSelect 의 칩 패턴을 분야 의존성 없이 재사용 가능하게 추출.
 * 긴 단일 선택은 SearchableSelect 를 사용한다.
 */
export function MultiSelectChips({
  options,
  value,
  onChange,
  max,
  loading = false,
  error,
  emptyMessage = '선택할 항목이 없습니다.',
}: MultiSelectChipsProps) {
  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else if (max == null || value.length < max) {
      onChange([...value, id]);
    }
  };

  if (loading) return <p className="text-sm text-neutral-base/60">불러오는 중…</p>;

  return (
    <div className="flex flex-col gap-1.5">
      {options.length === 0 ? (
        <p className="text-sm text-neutral-base/60">{emptyMessage}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => {
            const selected = value.includes(o.value);
            const disabled = !selected && max != null && value.length >= max;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                disabled={disabled}
                aria-pressed={selected}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors ${
                  selected
                    ? 'border-brand bg-brand text-white'
                    : disabled
                      ? 'border-border bg-surface text-neutral-base/40'
                      : 'border-border bg-surface-raised text-neutral-base hover:bg-surface'
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
      {error && <p className="text-sm font-medium text-brand">{error}</p>}
    </div>
  );
}
