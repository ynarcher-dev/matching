import { useLayoutEffect, useRef, useState } from 'react';
import { Badge } from '@/components/common/Badge';

interface FieldTagsProps {
  /** 표시할 분야명 목록. */
  names: string[];
  className?: string;
}

/**
 * 분야 태그 목록 — 가용 폭에 맞춰 최대한 노출하고, 넘치면 두 줄로 쓰지 않고 `+N` 으로 접는다.
 * 컨테이너 폭을 측정해 들어가는 개수를 계산하므로, 열을 넓히면 자동으로 더 많이 보인다.
 */
export function FieldTags({ names, className = '' }: FieldTagsProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [count, setCount] = useState(names.length);

  // names 변경 시 전부 보이기로 리셋(측정 시작점).
  useLayoutEffect(() => {
    setCount(names.length);
  }, [names]);

  // 넘치면 한 개씩 줄여가며 딱 맞는 개수를 찾는다(+N 뱃지 폭도 매 렌더 측정에 포함되어 자동 반영).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (count > 1 && el.scrollWidth > el.clientWidth + 1) {
      setCount((c) => c - 1);
    }
  }, [count, names]);

  // 열 폭이 바뀌면(크게보기 등) 다시 전부 보이기로 리셋 후 재측정.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCount(names.length));
    ro.observe(el);
    return () => ro.disconnect();
  }, [names]);

  if (names.length === 0) return null;

  const visible = names.slice(0, count);
  const hidden = names.length - visible.length;

  return (
    <span
      ref={ref}
      className={`flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden ${className}`}
      title={names.join(', ')}
    >
      {visible.map((n) => (
        <Badge key={n} tone="muted" className="whitespace-nowrap font-medium text-neutral-base">
          {n}
        </Badge>
      ))}
      {hidden > 0 && (
        <Badge tone="muted" className="whitespace-nowrap font-medium text-neutral-base/70">
          +{hidden}
        </Badge>
      )}
    </span>
  );
}
