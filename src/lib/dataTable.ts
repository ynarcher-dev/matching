/**
 * 공통 데이터 테이블 순수 로직 (functional_followup_plan.md §3 T3, development_status.md 8-C).
 *
 * 백오피스 테이블에 검색·필터·정렬·페이지네이션을 일관되게 적용하기 위한
 * 프레임워크 비의존 순수 함수 모음. 컴포넌트(DataTable/Pagination/FilterBar)와
 * 훅(useDataTable)이 이 함수들을 조합해 사용한다.
 */

/** 모든 데이터 테이블의 기본 페이지 크기(8-C 통일 기준: 30개). */
export const DEFAULT_PAGE_SIZE = 30;

/** 선택 가능한 페이지 크기 옵션. */
export const PAGE_SIZE_OPTIONS = [30, 50, 100] as const;

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  /** 컬럼 식별 키. */
  key: string;
  direction: SortDirection;
}

/** 정렬 비교에 쓰는 값 타입(문자열·숫자·null/undefined 허용). */
export type SortValue = string | number | null | undefined;

/**
 * 키워드 검색 필터. 공백만 입력하면 원본을 그대로 반환한다.
 * 비교는 trim + 소문자 정규화 후 부분 일치(includes).
 */
export function filterByKeyword<T>(
  rows: readonly T[],
  keyword: string,
  getText: (row: T) => string,
): T[] {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((row) => getText(row).toLowerCase().includes(needle));
}

/**
 * 여러 술어(predicate)를 모두 통과하는 행만 남긴다(AND 결합).
 * 각 필터는 `(row) => boolean`. 비어 있으면 원본을 반환.
 */
export function applyFilters<T>(rows: readonly T[], predicates: ReadonlyArray<(row: T) => boolean>): T[] {
  if (predicates.length === 0) return [...rows];
  return rows.filter((row) => predicates.every((p) => p(row)));
}

/**
 * 안정 정렬(stable sort). null/undefined 는 항상 뒤로 보낸다(방향 무관).
 * 문자열은 localeCompare(ko 우선), 숫자는 수치 비교.
 */
export function sortRows<T>(
  rows: readonly T[],
  getValue: (row: T) => SortValue,
  direction: SortDirection,
): T[] {
  const factor = direction === 'asc' ? 1 : -1;
  // index 를 보존해 동률일 때 원래 순서를 유지(안정 정렬).
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const va = getValue(a.row);
      const vb = getValue(b.row);
      const na = va === null || va === undefined;
      const nb = vb === null || vb === undefined;
      if (na && nb) return a.index - b.index;
      if (na) return 1; // null 은 항상 뒤
      if (nb) return -1;
      let cmp: number;
      if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
      } else {
        cmp = String(va).localeCompare(String(vb), 'ko');
      }
      if (cmp !== 0) return cmp * factor;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** 전체 행 수와 페이지 크기로 총 페이지 수를 구한다(최소 1). */
export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** 페이지 번호를 유효 범위[1, 총페이지]로 보정한다(1-기반). */
export function clampPage(page: number, total: number, pageSize: number): number {
  const last = pageCount(total, pageSize);
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.trunc(page)), last);
}

/** 현재 페이지(1-기반)에 해당하는 행 슬라이스를 반환한다. */
export function paginate<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const safePage = clampPage(page, rows.length, pageSize);
  const start = (safePage - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

/**
 * 정렬 헤더 클릭 시 다음 정렬 상태를 계산한다.
 * - 다른 컬럼 클릭: 해당 컬럼 오름차순(asc)
 * - 같은 컬럼 asc: desc 로 전환
 * - 같은 컬럼 desc: 정렬 해제(null)
 */
export function nextSort(current: SortState | null, key: string): SortState | null {
  if (!current || current.key !== key) return { key, direction: 'asc' };
  if (current.direction === 'asc') return { key, direction: 'desc' };
  return null;
}

export interface PageRange {
  /** 현재 페이지 첫 행의 1-기반 번호(전체 0이면 0). */
  from: number;
  /** 현재 페이지 마지막 행의 1-기반 번호. */
  to: number;
  total: number;
}

/** "N–M / 전체 T" 표기를 위한 범위 계산. */
export function pageRange(page: number, pageSize: number, total: number): PageRange {
  if (total === 0) return { from: 0, to: 0, total: 0 };
  const safePage = clampPage(page, total, pageSize);
  const from = (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);
  return { from, to, total };
}
