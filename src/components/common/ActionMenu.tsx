import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RowAction } from '@/components/common/RowActionGroup';

interface ActionMenuProps {
  actions: RowAction[];
  /** 트리거 버튼 레이블(접근성). 기본 '더보기'. */
  label?: string;
  className?: string;
}

const ITEM_TONE: Record<NonNullable<RowAction['tone']>, string> = {
  neutral: 'text-neutral-base hover:bg-surface',
  brand: 'text-brand hover:bg-danger-surface',
  danger: 'text-danger hover:bg-danger-surface',
};

/**
 * 액션이 많거나 모바일에서 접어야 할 때 사용하는 더보기 메뉴 (9-B).
 * 드롭다운은 document.body 포털 + fixed 위치로 렌더해, 테이블의 overflow 컨테이너에
 * 잘리거나 스크롤을 만들지 않는다(트리거 버튼 위치에 맞춰 우측 정렬).
 * 바깥 클릭·Esc·스크롤·리사이즈 시 닫힌다.
 */
export function ActionMenu({ actions, label = '더보기', className = '' }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // 트리거 위치에 맞춰 메뉴 좌표 계산(버튼 아래·우측 정렬).
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        triggerRef.current?.contains(t) ||
        menuRef.current?.contains(t)
      )
        return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // 스크롤/리사이즈 시 위치가 어긋나므로 닫는다(캡처로 모든 스크롤 컨테이너 포착).
    const onScrollOrResize = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <div className={`inline-block ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-base/70 transition-colors hover:bg-surface hover:text-neutral-base"
      >
        ⋯
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            style={{ position: 'fixed', top: pos.top, right: pos.right }}
            className="z-50 min-w-[140px] overflow-hidden rounded-lg border border-border bg-surface-raised py-1 shadow-md"
          >
            {actions.map((a) => (
              <button
                key={a.key}
                type="button"
                role="menuitem"
                disabled={a.disabled}
                onClick={() => {
                  setOpen(false);
                  a.onClick();
                }}
                className={`block w-full px-3 py-2 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  ITEM_TONE[a.tone ?? 'neutral']
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
