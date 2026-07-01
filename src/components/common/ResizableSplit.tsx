import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * 좌우 리사이저블 스플릿 패널 (docs/expert_dashboard_split_view_ideation.md §3①).
 * 가운데 경계선(Splitter)을 드래그/터치하여 좌우 너비 비율을 조절한다.
 *   - 최소/최대: 어느 한쪽도 minRatio 미만이 되지 않도록 제한(레이아웃 붕괴 방지).
 *   - 더블 클릭: 정확히 50:50 으로 초기화.
 *   - 좁은 화면(lg 미만): 분할 대신 세로 스택(상=left, 하=right)으로 전환, 드래그 비활성.
 */
export function ResizableSplit({
  left,
  right,
  initialRatio = 0.5,
  minRatio = 0.25,
  className = '',
  ariaLabel = '좌우 패널 크기 조절',
}: {
  left: ReactNode;
  right: ReactNode;
  /** 좌측 패널 초기 비율(0~1). */
  initialRatio?: number;
  /** 한쪽 최소 비율(반대쪽 최대 = 1 - minRatio). */
  minRatio?: number;
  className?: string;
  ariaLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(clamp(initialRatio, minRatio));
  const [dragging, setDragging] = useState(false);
  const [isWide, setIsWide] = useState(true);

  // lg(1024px) 미만에서는 세로 스택으로 전환한다.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const apply = () => setIsWide(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const updateFromClientX = useCallback(
    (clientX: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return;
      const next = (clientX - rect.left) / rect.width;
      setRatio(clamp(next, minRatio));
    },
    [minRatio],
  );

  useEffect(() => {
    if (!dragging) return;
    // 포인터 이동은 프레임당 1회만 반영(rAF 코얼레싱) — 과도한 setState 로 인한 버벅임 방지.
    let frame = 0;
    let lastX = 0;
    const flush = () => {
      frame = 0;
      updateFromClientX(lastX);
    };
    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      lastX = e.clientX;
      if (!frame) frame = requestAnimationFrame(flush);
    };
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    // 드래그 중 텍스트 선택·커서 깜빡임 방지.
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [dragging, updateFromClientX]);

  // 키보드 접근성: 화살표로 비율 5%p 씩 조절.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setRatio((r) => clamp(r - 0.05, minRatio));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setRatio((r) => clamp(r + 0.05, minRatio));
    }
  };

  if (!isWide) {
    // 세로 스택(모바일/태블릿): 분할·드래그 없이 상하 배치.
    return (
      <div className={`flex min-h-0 flex-col gap-3 ${className}`}>
        <div className="min-h-0 flex-1 overflow-hidden">{left}</div>
        <div className="min-h-0 flex-1 overflow-hidden">{right}</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative flex min-h-0 w-full ${className}`}>
      {/* 드래그 중 전체를 덮는 투명 오버레이: iframe(PDF·웹 미리보기)이 포인터 이벤트를
          가로채 드래그가 끊기는 현상을 막는다. */}
      {dragging && <div className="fixed inset-0 z-50 cursor-col-resize" />}

      <div className="min-w-0 overflow-hidden" style={{ width: `${ratio * 100}%` }}>
        {left}
      </div>

      {/* 경계선(Splitter) */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={ariaLabel}
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDoubleClick={() => setRatio(0.5)}
        onKeyDown={onKeyDown}
        title="드래그하여 좌우 비율 조절 · 더블 클릭 시 50:50"
        className={`group relative flex w-2 shrink-0 cursor-col-resize items-center justify-center ${
          dragging ? 'bg-brand/20' : 'bg-border/60 hover:bg-brand/20'
        } transition-colors`}
      >
        <span
          className={`h-10 w-0.5 rounded-full ${
            dragging ? 'bg-brand' : 'bg-neutral-base/30 group-hover:bg-brand'
          }`}
        />
      </div>

      <div className="min-w-0 flex-1 overflow-hidden">{right}</div>
    </div>
  );
}

/** 비율을 [min, 1-min] 범위로 제한. */
function clamp(value: number, min: number): number {
  const lo = Math.max(0.05, min);
  return Math.min(1 - lo, Math.max(lo, value));
}
