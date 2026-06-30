import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PAGE_SIZE,
  applyFilters,
  clampPage,
  filterByKeyword,
  nextSort,
  pageCount,
  pageRange,
  paginate,
  sortRows,
  type PageRange,
  type SortState,
  type SortValue,
} from '@/lib/dataTable';
import { useDebouncedValue } from './useDebouncedValue';

export interface UseDataTableOptions<T> {
  /** 키워드 검색에 사용할 행 텍스트(여러 필드를 합쳐 전달). 없으면 검색 비활성. */
  getSearchText?: (row: T) => string;
  /** 정렬 가능한 컬럼 키 → 정렬 값 추출 함수. */
  sortValues?: Record<string, (row: T) => SortValue>;
  /**
   * 추가 필터 술어들(AND 결합). 모두 통과한 행만 남는다.
   * ⚠ 호출부에서 `useMemo` 로 감싸 참조를 안정화해야 한다(배열 참조가
   * 바뀔 때만 재계산·1페이지 리셋이 일어난다).
   */
  filters?: ReadonlyArray<(row: T) => boolean>;
  /** 초기 정렬 상태. */
  initialSort?: SortState | null;
  /** 페이지 크기(기본 30). */
  pageSize?: number;
  /** 검색 디바운스(ms). */
  debounceMs?: number;
}

export interface UseDataTableResult<T> {
  /** 현재 페이지에 표시할 행. */
  rows: T[];
  /** 검색·필터 적용 후(페이지네이션 전) 전체 행 수. */
  totalFiltered: number;
  search: string;
  setSearch: (value: string) => void;
  sort: SortState | null;
  /** 헤더 클릭 시 정렬 순환(asc→desc→해제). */
  toggleSort: (key: string) => void;
  page: number;
  setPage: (page: number) => void;
  totalPages: number;
  pageSize: number;
  range: PageRange;
}

const EMPTY_FILTERS: ReadonlyArray<(row: never) => boolean> = [];

/**
 * 검색·필터·정렬·페이지네이션 상태를 한데 묶는 공통 테이블 훅(8-C).
 * 순수 로직은 lib/dataTable 에 위임하고, 여기서는 상태와 파생 계산만 관리한다.
 *
 * 검색어/필터/정렬이 바뀌면 1페이지로 되돌리고, 데이터가 줄어 현재 페이지가
 * 범위를 벗어나면 마지막 페이지로 보정한다.
 */
export function useDataTable<T>(
  data: readonly T[],
  options: UseDataTableOptions<T> = {},
): UseDataTableResult<T> {
  const {
    getSearchText,
    sortValues,
    filters = EMPTY_FILTERS as ReadonlyArray<(row: T) => boolean>,
    initialSort = null,
    pageSize = DEFAULT_PAGE_SIZE,
    debounceMs = 200,
  } = options;

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState | null>(initialSort);
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search, debounceMs);

  // 검색·필터·정렬 적용(페이지네이션 전).
  const processed = useMemo(() => {
    let result: T[] = getSearchText
      ? filterByKeyword(data, debouncedSearch, getSearchText)
      : [...data];
    result = applyFilters(result, filters);
    if (sort && sortValues?.[sort.key]) {
      result = sortRows(result, sortValues[sort.key], sort.direction);
    }
    return result;
  }, [data, debouncedSearch, sort, sortValues, filters, getSearchText]);

  const totalFiltered = processed.length;
  const totalPages = pageCount(totalFiltered, pageSize);

  // 검색·필터 변경 시 1페이지로 리셋.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filters]);

  // 데이터 축소로 현재 페이지가 범위를 벗어나면 보정.
  const safePage = clampPage(page, totalFiltered, pageSize);
  useEffect(() => {
    if (safePage !== page) setPage(safePage);
  }, [safePage, page]);

  const rows = useMemo(
    () => paginate(processed, safePage, pageSize),
    [processed, safePage, pageSize],
  );

  const toggleSort = (key: string) => setSort((current) => nextSort(current, key));

  return {
    rows,
    totalFiltered,
    search,
    setSearch,
    sort,
    toggleSort,
    page: safePage,
    setPage,
    totalPages,
    pageSize,
    range: pageRange(safePage, pageSize, totalFiltered),
  };
}
