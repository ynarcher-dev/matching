import type { ReactNode } from 'react';

interface PageToolbarProps {
  /** 좌측: 검색 입력(SearchInput 등). */
  search?: ReactNode;
  /** 가운데: 필터칩/세그먼트. */
  filters?: ReactNode;
  /** 우측: 주요 액션 버튼(추가/내보내기 등). */
  actions?: ReactNode;
  className?: string;
}

/**
 * 목록 화면 상단 도구 영역 (9-B). 검색 + 필터 + 우측 액션을 일관된 레이아웃으로 묶는다.
 * FilterBar(검색·필터만)보다 상위 — 우측 주요 액션까지 포함한 페이지 머리띠.
 */
export function PageToolbar({ search, filters, actions, className = '' }: PageToolbarProps) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {search}
        {filters}
      </div>
      {actions != null && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
