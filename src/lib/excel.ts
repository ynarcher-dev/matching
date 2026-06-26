import ExcelJS from 'exceljs';

/**
 * 범용 xlsx 워크북 생성·다운로드 래퍼 (Phase 7 슬라이스 3).
 * exceljs 로 다중 시트 워크북을 만들고 브라우저에서 파일로 내려준다.
 * 외부 API 가 아니라 클라이언트에서 오프라인 생성한다(서버 왕복 없음).
 * 도메인 데이터 → 시트(SheetSpec) 변환은 lib/eventExport.ts(순수 함수)가 담당한다.
 */

/** 한 열의 머리글과 너비(글자 수 기준). */
export interface SheetColumn {
  header: string;
  width?: number;
}

/** 시트 1장 명세: 이름 + 열 정의 + 데이터 행렬. */
export interface SheetSpec {
  name: string;
  columns: SheetColumn[];
  rows: (string | number | null)[][];
}

/** 시트 명세 배열로 xlsx 바이너리(ArrayBuffer)를 만든다. */
export async function buildWorkbookBuffer(sheets: SheetSpec[]): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'YNA 비즈니스 매칭';

  for (const spec of sheets) {
    const ws = workbook.addWorksheet(spec.name);
    ws.columns = spec.columns.map((c) => ({ header: c.header, width: c.width ?? 18 }));
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: 'middle' };
    for (const row of spec.rows) {
      ws.addRow(row.map((v) => (v === null ? '' : v)));
    }
    // 머리글 고정(스크롤 시 유지).
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

/** 시트들을 xlsx 로 만들어 파일 다운로드를 트리거한다. */
export async function downloadSheets(sheets: SheetSpec[], filename: string): Promise<void> {
  const buffer = await buildWorkbookBuffer(sheets);
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
