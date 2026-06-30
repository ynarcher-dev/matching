export interface RowAction {
  key: string;
  label: string;
  onClick: () => void;
  /** 파괴적 액션(삭제·취소 등)은 danger 로 표시. */
  tone?: 'neutral' | 'brand' | 'danger';
  disabled?: boolean;
}

interface RowActionGroupProps {
  actions: RowAction[];
  /** 좌측 정렬 여부(기본 우측). */
  align?: 'left' | 'right';
  className?: string;
}

const TONE: Record<NonNullable<RowAction['tone']>, string> = {
  neutral: 'text-neutral-base/70 hover:text-neutral-base',
  brand: 'text-brand hover:text-brand-hover',
  danger: 'text-danger hover:text-danger/80',
};

/**
 * 테이블 행/카드 액션을 한 줄로 나열 (9-B). 액션이 적을 때 사용한다.
 * 액션이 많거나 모바일에서 접어야 하면 ActionMenu 를 사용한다.
 */
export function RowActionGroup({ actions, align = 'right', className = '' }: RowActionGroupProps) {
  if (actions.length === 0) return null;
  return (
    <div
      className={`flex items-center gap-3 ${align === 'right' ? 'justify-end' : ''} ${className}`}
    >
      {actions.map((a) => (
        <button
          key={a.key}
          type="button"
          onClick={a.onClick}
          disabled={a.disabled}
          className={`text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            TONE[a.tone ?? 'neutral']
          }`}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

