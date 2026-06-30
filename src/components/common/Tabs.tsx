import { Badge } from '@/components/common/Badge';

export interface TabOption<V extends string> {
  value: V;
  label: string;
  /** 라벨 우측 카운트 배지(선택). */
  count?: number;
}

interface TabsProps<V extends string> {
  value: V;
  options: ReadonlyArray<TabOption<V>>;
  onChange: (value: V) => void;
  ariaLabel?: string;
  className?: string;
}

/**
 * 페이지/상세 영역 전환 탭 (9-B / 9-E 밑줄형).
 * 하단 경계선 위에 탭을 얹고, 선택 탭만 브랜드 텍스트 + 브랜드 밑줄로 강조한다.
 * 탭이 많아도 한 줄 가로 스크롤로 처리(모바일 대응). 떠 보이지 않게 경계선으로 그라운딩.
 * 작은 상태/보기 전환은 SegmentedControl, 필터 전용은 FilterChips 를 사용한다.
 */
export function Tabs<V extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className = '',
}: TabsProps<V>) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="flex min-w-max items-center gap-1 border-b border-border"
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
              className={`-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
                active
                  ? 'border-brand text-brand'
                  : 'border-transparent text-neutral-base/60 hover:text-neutral-base'
              }`}
            >
              {opt.label}
              {opt.count != null && (
                <Badge
                  tone={active ? 'brand' : 'muted'}
                  size="11"
                >
                  {opt.count}
                </Badge>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
