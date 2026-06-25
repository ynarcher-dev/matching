import type { HTMLAttributes } from 'react';

/**
 * 일반 카드 (page_auth_layout.md §2.1).
 * 흰색 배경, 12~16px 모서리, 1px 중립 회색 경계선, 제한적인 약한 그림자.
 */
export function Card({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-2xl border border-border bg-white shadow-sm ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
