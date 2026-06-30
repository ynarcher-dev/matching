import type { ReactNode } from 'react';

/**
 * 통계 요약 카드(흰색). 상단 라벨 + 큰 값으로 한 지표를 보여준다.
 * 1행에 여러 개를 grid 로 나열해 쓴다(예: grid-cols-2).
 */
export function StatCard({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-lg border border-border bg-white px-4 py-3 ${className}`}
    >
      <span className="text-sm text-neutral-base/70">{label}</span>
      <span className="text-lg font-bold text-neutral-base">{children}</span>
    </div>
  );
}
