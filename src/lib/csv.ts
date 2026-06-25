/**
 * 의존성 없는 CSV 파서 (RFC 4180 기반, page_admin_user_management.md §3 utils/csvParser).
 * 따옴표로 감싼 필드 내부의 쉼표·줄바꿈·이스케이프 따옴표("")를 처리한다.
 * 외부 라이브러리(Papaparse 등) 대신 작고 테스트 가능한 파서를 둬서 번들/의존성을 줄인다.
 *
 * 반환: 셀 문자열의 2차원 배열(행 단위). 헤더 해석·필드 매핑은 상위(lib/userCsv)에서 한다.
 */
export function parseCsv(input: string): string[][] {
  // BOM 제거. 줄바꿈은 파서가 따옴표 상태를 보며 직접 처리한다.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // CRLF / CR 모두 한 줄 끝으로 본다.
      pushRow();
      i += text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // 마지막 필드/행 마감(파일이 줄바꿈 없이 끝나는 경우).
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  // 완전히 빈 행(모든 셀이 공백) 제거.
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
