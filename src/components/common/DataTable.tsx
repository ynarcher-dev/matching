import type { ReactNode } from 'react';
import type { SortState } from '@/lib/dataTable';

export interface DataTableColumn<T> {
  /** 컬럼 식별 키(정렬 토글·React key 에 사용). */
  key: string;
  header: ReactNode;
  /** 셀 렌더러. index 는 현재 페이지 내 0-기준 행 번호. */
  cell: (row: T, index: number) => ReactNode;
  /** 정렬 가능 여부(클릭 시 onSort 호출). 정렬 값은 useDataTable 의 sortValues 로 제공. */
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  /** th/td 공통 추가 클래스. */
  className?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort?: SortState | null;
  onSort?: (key: string) => void;
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  /** 가로 스크롤 최소 너비 클래스(예: 'min-w-[1080px]'). */
  minWidthClass?: string;
  onRowClick?: (row: T) => void;
  /** 행별 추가 클래스(상태 강조 등). 기본 행 스타일 뒤에 덧붙는다. */
  rowClassName?: (row: T) => string;
}

const ALIGN_CLASS: Record<NonNullable<DataTableColumn<unknown>['align']>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

/**
 * 공통 데이터 테이블 (8-C). 기존 UserTable/OperatorTable 등의 마크업 패턴을
 * 컬럼 정의 기반으로 일반화. 정렬 헤더·로딩·에러·빈 상태를 표준 처리한다.
 * 정렬/검색/페이지 상태는 useDataTable 훅이 관리하고, 여기서는 표시만 담당.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  loading = false,
  error = null,
  emptyMessage = '표시할 데이터가 없습니다.',
  minWidthClass = '',
  onRowClick,
  rowClassName,
}: DataTableProps<T>) {
  const colSpan = columns.length;

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface-raised">
      <table className={`w-full border-collapse text-left text-sm ${minWidthClass}`}>
        <thead>
          <tr className="border-b border-border bg-surface text-neutral-base/80">
            {columns.map((col) => (
              <HeaderCell
                key={col.key}
                column={col}
                sort={sort}
                onSort={col.sortable && onSort ? () => onSort(col.key) : undefined}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <StateRow colSpan={colSpan} tone="muted">
              불러오는 중…
            </StateRow>
          ) : error ? (
            <StateRow colSpan={colSpan} tone="danger">
              {error}
            </StateRow>
          ) : rows.length === 0 ? (
            <StateRow colSpan={colSpan} tone="muted">
              {emptyMessage}
            </StateRow>
          ) : (
            rows.map((row, rowIndex) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-border last:border-b-0 hover:bg-surface/60 ${
                  onRowClick ? 'cursor-pointer' : ''
                } ${rowClassName?.(row) ?? ''}`}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-3 py-2.5 align-middle ${
                      ALIGN_CLASS[col.align ?? 'left']
                    } ${col.className ?? ''}`}
                  >
                    {col.cell(row, rowIndex)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function HeaderCell<T>({
  column,
  sort,
  onSort,
}: {
  column: DataTableColumn<T>;
  sort?: SortState | null;
  onSort?: () => void;
}) {
  const active = sort?.key === column.key;
  const indicator = active ? (sort?.direction === 'asc' ? '▲' : '▼') : '↕';
  const alignClass = ALIGN_CLASS[column.align ?? 'left'];

  if (!onSort) {
    return (
      <th className={`whitespace-nowrap px-3 py-2.5 font-semibold ${alignClass} ${column.className ?? ''}`}>
        {column.header}
      </th>
    );
  }

  return (
    <th className={`whitespace-nowrap px-3 py-2.5 font-semibold ${alignClass} ${column.className ?? ''}`}>
      <button
        type="button"
        onClick={onSort}
        className="inline-flex items-center gap-1 font-semibold text-neutral-base/80 transition-colors hover:text-brand"
      >
        {column.header}
        <span className={`text-xs ${active ? 'text-brand' : 'text-neutral-base/40'}`}>{indicator}</span>
      </button>
    </th>
  );
}

function StateRow({
  colSpan,
  tone,
  children,
}: {
  colSpan: number;
  tone: 'muted' | 'danger';
  children: ReactNode;
}) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className={`px-3 py-10 text-center text-sm ${
          tone === 'danger' ? 'text-brand' : 'text-neutral-base/60'
        }`}
      >
        {children}
      </td>
    </tr>
  );
}
