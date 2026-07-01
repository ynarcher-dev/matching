import { describe, it, expect } from 'vitest';
import { sanitizeCell } from '@/lib/exportSafety';
import { toCsv } from '@/lib/surveyReport';

describe('sanitizeCell (수식 인젝션 방어)', () => {
  it('위험 접두 문자로 시작하면 작은따옴표를 붙인다', () => {
    expect(sanitizeCell('=HYPERLINK("http://evil","x")')).toBe("'=HYPERLINK(\"http://evil\",\"x\")");
    expect(sanitizeCell('+1+1')).toBe("'+1+1");
    expect(sanitizeCell('-1+1')).toBe("'-1+1");
    expect(sanitizeCell('@SUM(1,1)')).toBe("'@SUM(1,1)");
    expect(sanitizeCell('=1+1')).toBe("'=1+1");
    expect(sanitizeCell('\tTAB')).toBe("'\tTAB");
    expect(sanitizeCell('\rCR')).toBe("'\rCR");
  });

  it('안전한 문자열·숫자·null 은 그대로 둔다', () => {
    expect(sanitizeCell('안녕하세요')).toBe('안녕하세요');
    expect(sanitizeCell('A사')).toBe('A사');
    expect(sanitizeCell('010-1234-5678')).toBe('010-1234-5678'); // 중간의 - 는 무해
    expect(sanitizeCell(42)).toBe(42);
    expect(sanitizeCell(null)).toBe(null);
    expect(sanitizeCell('')).toBe('');
  });
});

describe('toCsv 수식 인젝션 방어', () => {
  it('셀이 수식으로 저장되지 않도록 prefix 후 이스케이프', () => {
    const csv = toCsv(
      ['이름', '수식'],
      [
        ['A사', '=1+1'],
        ['B사', '=HYPERLINK("http://evil","x")'],
        ['C사', '@SUM(1,1)'],
      ],
    );
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe("A사,'=1+1");
    // 따옴표 포함 → CSV 감싸기까지 적용
    expect(lines[2]).toBe('B사,"\'=HYPERLINK(""http://evil"",""x"")"');
    // 쉼표 포함 → prefix 후 CSV 감싸기까지 적용
    expect(lines[3]).toBe('C사,"\'@SUM(1,1)"');
  });
});
