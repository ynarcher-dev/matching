import type { ReactNode } from 'react';

interface EmptyStateProps {
  /** 상단 큰 글리프/아이콘(선택). */
  icon?: ReactNode;
  /** 핵심 한 줄 메시지. */
  title: string;
  /** 보조 설명(선택). */
  description?: ReactNode;
  /** 우측/하단 액션(예: 추가 버튼). */
  action?: ReactNode;
  /** 변형: 'default'(빈 목록) | 'denied'(권한 없음) | 'search'(검색 결과 없음). */
  variant?: 'default' | 'denied' | 'search';
  className?: string;
}

const DEFAULT_ICON: Record<NonNullable<EmptyStateProps['variant']>, string> = {
  default: '📭',
  denied: '🔒',
  search: '🔍',
};

/**
 * 공통 빈/권한없음/검색없음 상태 (9-B). 화면마다 제각각이던 빈 상태 안내를 통일한다.
 * loading/error 는 각 데이터 컴포넌트(DataTable 등)가 담당하고, 여기는 "내용 없음"만.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = 'default',
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center ${className}`}
    >
      <span className="text-3xl" aria-hidden>
        {icon ?? DEFAULT_ICON[variant]}
      </span>
      <p className="text-base font-semibold text-neutral-base">{title}</p>
      {description != null && (
        <p className="max-w-md text-sm text-neutral-base/60">{description}</p>
      )}
      {action != null && <div className="mt-1">{action}</div>}
    </div>
  );
}
