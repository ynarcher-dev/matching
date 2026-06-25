import { useFields } from '@/hooks/useFields';

interface FieldMultiSelectProps {
  /** 선택된 field_id 목록. */
  value: string[];
  onChange: (next: string[]) => void;
  /** 최대 선택 개수(기본 3). */
  max?: number;
  /** 검증 오류 메시지. */
  error?: string;
}

/**
 * 관심/전문 분야 다중 선택 (page_admin_user_management.md §2.4 — 최대 3개).
 * 칩 토글 방식. 상한 도달 시 미선택 칩을 비활성화한다(시각·기능 동시 차단).
 */
export function FieldMultiSelect({ value, onChange, max = 3, error }: FieldMultiSelectProps) {
  const { data: fields, isLoading, isError } = useFields();

  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else if (value.length < max) {
      onChange([...value, id]);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-neutral-base">관심/전문 분야</span>
        <span className="text-xs text-neutral-base/60">
          {value.length}/{max}
        </span>
      </div>
      {isLoading && <p className="text-sm text-neutral-base/60">분야 목록을 불러오는 중…</p>}
      {isError && <p className="text-sm font-medium text-brand">분야 목록을 불러오지 못했습니다.</p>}
      {fields && (
        <div className="flex flex-wrap gap-1.5">
          {fields.map((f) => {
            const selected = value.includes(f.id);
            const disabled = !selected && value.length >= max;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => toggle(f.id)}
                disabled={disabled}
                aria-pressed={selected}
                className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                  selected
                    ? 'border-brand bg-brand text-white'
                    : disabled
                      ? 'border-border bg-surface text-neutral-base/40'
                      : 'border-border bg-white text-neutral-base hover:bg-surface'
                }`}
              >
                {f.name}
              </button>
            );
          })}
        </div>
      )}
      {error && <p className="text-sm font-medium text-brand">{error}</p>}
    </div>
  );
}
