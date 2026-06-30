import { useEffect } from 'react';
import type { ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** 푸터 액션(버튼 등). 우측 정렬 영역에 렌더된다. */
  footer?: ReactNode;
  /** 본문 최대 너비(기본 lg). xl 은 넓은 표(참가자 지정 등)용. */
  size?: 'md' | 'lg' | 'xl';
}

const SIZE: Record<NonNullable<ModalProps['size']>, string> = {
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-5xl',
};

/**
 * 열려 있는 모달 스택. 중첩 모달(설정 모달 안의 문항 편집 모달 등)에서
 * Esc 가 최상단 모달만 닫도록 한다(8-F: 결과 설정 모달 ↔ 빌더 내부 편집 모달).
 */
const modalStack: symbol[] = [];

/**
 * 공통 모달 (page_auth_layout.md §2.1 위계 — 연한 그림자·1px 경계선).
 * 백드롭 클릭/Esc 로 닫고, 본문은 스크롤 가능. 인라인 스타일 없이 Tailwind 만 사용.
 */
export function Modal({ open, onClose, title, children, footer, size = 'lg' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const id = Symbol('modal');
    modalStack.push(id);
    const onKey = (e: KeyboardEvent) => {
      // 최상단(가장 최근 열림) 모달만 Esc 로 닫는다.
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === id) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const idx = modalStack.indexOf(id);
      if (idx >= 0) modalStack.splice(idx, 1);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={onClose}
    >
      <div
        className={`flex max-h-[92vh] w-full ${SIZE[size]} flex-col overflow-hidden rounded-t-2xl bg-white shadow-lg sm:rounded-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-bold text-neutral-base">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded-md p-1 text-neutral-base/70 transition-colors hover:bg-surface hover:text-neutral-base"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-border px-5 py-4">{footer}</div>
        )}
      </div>
    </div>
  );
}
