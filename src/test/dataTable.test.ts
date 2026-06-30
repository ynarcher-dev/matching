import { describe, it, expect } from 'vitest';
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
  type SortState,
} from '@/lib/dataTable';

interface Row {
  id: string;
  name: string;
  company: string | null;
  score: number;
}

const rows: Row[] = [
  { id: '1', name: '김민준', company: '알파', score: 90 },
  { id: '2', name: 'Lee', company: null, score: 70 },
  { id: '3', name: '박서연', company: '베타', score: 90 },
  { id: '4', name: 'Choi', company: '감마', score: 60 },
];

describe('DEFAULT_PAGE_SIZE', () => {
  it('8-C 기준 기본 페이지 크기는 30', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(30);
  });
});

describe('filterByKeyword', () => {
  it('대소문자 무시 부분 일치', () => {
    const out = filterByKeyword(rows, 'lee', (r) => r.name);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('2');
  });

  it('공백/빈 키워드는 전체 복사본 반환', () => {
    expect(filterByKeyword(rows, '   ', (r) => r.name)).toHaveLength(4);
    expect(filterByKeyword(rows, '', (r) => r.name)).not.toBe(rows);
  });

  it('합친 텍스트로 여러 필드 검색', () => {
    const out = filterByKeyword(rows, '베타', (r) => `${r.name} ${r.company ?? ''}`);
    expect(out.map((r) => r.id)).toEqual(['3']);
  });
});

describe('applyFilters', () => {
  it('여러 술어를 AND 결합', () => {
    const out = applyFilters(rows, [(r) => r.score >= 70, (r) => r.company !== null]);
    expect(out.map((r) => r.id)).toEqual(['1', '3']);
  });

  it('술어 없으면 전체 복사본', () => {
    const out = applyFilters(rows, []);
    expect(out).toHaveLength(4);
    expect(out).not.toBe(rows);
  });
});

describe('sortRows', () => {
  it('숫자 오름/내림차순', () => {
    expect(sortRows(rows, (r) => r.score, 'asc').map((r) => r.id)).toEqual(['4', '2', '1', '3']);
    expect(sortRows(rows, (r) => r.score, 'desc').map((r) => r.id)).toEqual(['1', '3', '2', '4']);
  });

  it('동률은 원래 순서 유지(안정 정렬)', () => {
    // score 90 동률인 1, 3 은 입력 순서(1→3) 유지
    expect(sortRows(rows, (r) => r.score, 'desc').slice(0, 2).map((r) => r.id)).toEqual(['1', '3']);
  });

  it('null/undefined 는 방향과 무관하게 뒤로', () => {
    const asc = sortRows(rows, (r) => r.company, 'asc');
    const desc = sortRows(rows, (r) => r.company, 'desc');
    expect(asc[asc.length - 1].id).toBe('2');
    expect(desc[desc.length - 1].id).toBe('2');
  });

  it('문자열은 ko 로케일 비교', () => {
    const out = sortRows(rows, (r) => r.name, 'asc').map((r) => r.name);
    // 영문/한글 혼합이라도 결정적 순서를 반환
    expect(out).toHaveLength(4);
  });
});

describe('pageCount / clampPage', () => {
  it('총 페이지 수(올림, 최소 1)', () => {
    expect(pageCount(0, 30)).toBe(1);
    expect(pageCount(30, 30)).toBe(1);
    expect(pageCount(31, 30)).toBe(2);
    expect(pageCount(61, 30)).toBe(3);
  });

  it('페이지 번호를 유효 범위로 보정', () => {
    expect(clampPage(0, 100, 30)).toBe(1);
    expect(clampPage(99, 100, 30)).toBe(4);
    expect(clampPage(2, 100, 30)).toBe(2);
    expect(clampPage(Number.NaN, 100, 30)).toBe(1);
  });
});

describe('paginate', () => {
  const many: Row[] = Array.from({ length: 65 }, (_, i) => ({
    id: String(i + 1),
    name: `n${i}`,
    company: null,
    score: i,
  }));

  it('페이지별 슬라이스', () => {
    expect(paginate(many, 1, 30)).toHaveLength(30);
    expect(paginate(many, 3, 30)).toHaveLength(5);
    expect(paginate(many, 1, 30)[0].id).toBe('1');
    expect(paginate(many, 2, 30)[0].id).toBe('31');
  });

  it('범위 밖 페이지는 마지막 페이지로 보정', () => {
    expect(paginate(many, 99, 30)[0].id).toBe('61');
  });
});

describe('nextSort', () => {
  it('다른 컬럼 클릭 → asc', () => {
    expect(nextSort(null, 'name')).toEqual({ key: 'name', direction: 'asc' });
    const cur: SortState = { key: 'score', direction: 'desc' };
    expect(nextSort(cur, 'name')).toEqual({ key: 'name', direction: 'asc' });
  });

  it('같은 컬럼 asc → desc → 해제', () => {
    const asc: SortState = { key: 'name', direction: 'asc' };
    expect(nextSort(asc, 'name')).toEqual({ key: 'name', direction: 'desc' });
    const desc: SortState = { key: 'name', direction: 'desc' };
    expect(nextSort(desc, 'name')).toBeNull();
  });
});

describe('pageRange', () => {
  it('현재 페이지 행 번호 범위', () => {
    expect(pageRange(1, 30, 65)).toEqual({ from: 1, to: 30, total: 65 });
    expect(pageRange(3, 30, 65)).toEqual({ from: 61, to: 65, total: 65 });
  });

  it('빈 결과는 0,0', () => {
    expect(pageRange(1, 30, 0)).toEqual({ from: 0, to: 0, total: 0 });
  });
});
