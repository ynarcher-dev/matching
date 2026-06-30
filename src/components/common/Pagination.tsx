import { pageRange } from '@/lib/dataTable';

export interface PaginationProps {
  page: number;
  totalPages: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

/**
 * 공통 페이지네이션 컨트롤 (8-C). "N–M / 전체 T" 범위 표기 + 이전/다음 +
 * 윈도우형 페이지 번호. 페이지가 1개뿐이면 범위 요약만 노출한다.
 */
export function Pagination({ page, totalPages, pageSize, total, onPageChange }: PaginationProps) {
  const range = pageRange(page, pageSize, total);
  const numbers = pageWindow(page, totalPages);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-2 text-sm text-neutral-base/70">
      <span>
        {range.total === 0
          ? '결과 없음'
          : `${range.from.toLocaleString()}–${range.to.toLocaleString()} / 전체 ${range.total.toLocaleString()}개`}
      </span>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <PageButton disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            이전
          </PageButton>
          {numbers.map((n, i) =>
            n === ELLIPSIS ? (
              <span key={`gap-${i}`} className="px-1 text-neutral-base/40">
                …
              </span>
            ) : (
              <PageButton key={n} active={n === page} onClick={() => onPageChange(n)}>
                {n}
              </PageButton>
            ),
          )}
          <PageButton disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
            다음
          </PageButton>
        </div>
      )}
    </div>
  );
}

const ELLIPSIS = -1;

/** 현재 페이지 주변 + 양끝을 보여주는 페이지 번호 윈도우(생략은 -1). */
function pageWindow(page: number, totalPages: number): number[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const result: number[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) result.push(ELLIPSIS);
  for (let n = start; n <= end; n += 1) result.push(n);
  if (end < totalPages - 1) result.push(ELLIPSIS);
  result.push(totalPages);
  return result;
}

function PageButton({
  children,
  onClick,
  active = false,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-w-8 rounded-md border px-2 py-1 text-xs font-semibold transition-colors disabled:opacity-40 ${
        active
          ? 'border-brand bg-brand text-white'
          : 'border-border text-neutral-base hover:bg-surface'
      }`}
    >
      {children}
    </button>
  );
}
