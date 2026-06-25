interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** 스크린리더용 라벨. */
  label: string;
  disabled?: boolean;
}

/**
 * 공통 토글 스위치 (page_admin_event_detail.md §3.2 자율 예약 허용).
 * 1px 경계선 기반·켜짐 시 브랜드 면. 인라인 스타일 없이 Tailwind 만 사용.
 */
export function Toggle({ checked, onChange, label, disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 ${
        checked ? 'border-brand bg-brand' : 'border-border bg-surface'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}
