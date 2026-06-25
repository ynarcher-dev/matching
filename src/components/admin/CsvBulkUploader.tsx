import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { Alert } from '@/components/common/Alert';
import { useBulkCreateUsers } from '@/hooks/useUserMutations';
import { parseUserCsv, CSV_TEMPLATE } from '@/lib/userCsv';
import type { CsvParseSummary } from '@/lib/userCsv';

interface CsvBulkUploaderProps {
  open: boolean;
  onClose: () => void;
  /** 활성 사용자 이메일(소문자) 집합 — 파일 내/기존 중복 검사용. */
  existingEmails: Set<string>;
}

/** 템플릿 CSV 를 내려받는다(UTF-8 BOM 포함 — Excel 한글 호환). */
function downloadTemplate() {
  const blob = new Blob(['﻿' + CSV_TEMPLATE], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'participants_template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * CSV 일괄 업로드 모달 (page_admin_user_management.md §2).
 * 파일 선택/드래그앤드롭 → 라인별 검증 → 오류 0건일 때만 일괄 등록한다.
 */
export function CsvBulkUploader({ open, onClose, existingEmails }: CsvBulkUploaderProps) {
  const [fileName, setFileName] = useState('');
  const [summary, setSummary] = useState<CsvParseSummary | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bulk = useBulkCreateUsers();

  useEffect(() => {
    if (open) {
      setFileName('');
      setSummary(null);
      setDragOver(false);
      bulk.reset();
    }
    // bulk 는 안정 참조가 아니므로 의존성에서 제외(open 토글에만 초기화).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    bulk.reset();
    const text = await file.text();
    setSummary(parseUserCsv(text, existingEmails));
  };

  const onConfirm = () => {
    if (!summary || summary.errors.length > 0 || summary.rows.length === 0) return;
    bulk.mutate(summary.rows, { onSuccess: () => onClose() });
  };

  const canSubmit =
    summary !== null && summary.errors.length === 0 && summary.rows.length > 0 && !bulk.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="CSV 일괄 업로드"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={bulk.isPending}>
            닫기
          </Button>
          <Button onClick={onConfirm} loading={bulk.isPending} disabled={!canSubmit}>
            {summary ? `${summary.rows.length}명 등록` : '등록'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-neutral-base/80">
            템플릿 양식에 맞춰 작성한 .csv 파일을 올려 주세요. 필수: 역할·이름·이메일.
          </p>
          <button
            type="button"
            onClick={downloadTemplate}
            className="text-sm font-semibold text-brand underline-offset-2 hover:underline"
          >
            템플릿 내려받기
          </button>
        </div>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors ${
            dragOver ? 'border-brand bg-danger-surface' : 'border-border bg-surface'
          }`}
        >
          <span className="text-sm font-semibold text-neutral-base">
            여기로 파일을 끌어다 놓거나 클릭해 선택
          </span>
          <span className="text-sm text-neutral-base/70">{fileName || 'CSV 파일 (.csv)'}</span>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </label>

        {bulk.isError && <Alert tone="error">{(bulk.error as Error).message}</Alert>}

        {summary && <SummaryReport summary={summary} />}
      </div>
    </Modal>
  );
}

/** 검증 결과: 등록 가능 건수 + 라인별 오류 리스트. */
function SummaryReport({ summary }: { summary: CsvParseSummary }) {
  if (summary.errors.length === 0) {
    return (
      <Alert tone="success">
        {summary.totalDataRows}개 행을 확인했습니다. {summary.rows.length}명을 등록할 수 있습니다.
      </Alert>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Alert tone="error">
        {summary.errors.length}개 행에 오류가 있어 등록할 수 없습니다. 오류를 수정한 뒤 다시
        올려 주세요.
      </Alert>
      <ul className="max-h-48 overflow-y-auto rounded-lg border border-border bg-surface p-3 text-sm text-neutral-base">
        {summary.errors.map((err, i) => (
          <li key={`${err.line}-${i}`} className="py-0.5">
            {err.line > 0 ? `${err.line}번 라인: ` : ''}
            {err.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
