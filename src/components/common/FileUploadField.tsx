import { Button } from '@/components/common/Button';

interface FileUploadFieldProps {
  /** 항목 라벨(예: 사업소개서). */
  label: string;
  /** 우측 보조 힌트(허용 형식·용량 등). */
  hint?: string;
  /** input accept 속성. */
  accept?: string;
  /** 현재 첨부 존재 여부(저장된 파일). */
  hasCurrent?: boolean;
  /** 현재 첨부 원본 파일명(있으면 안내문 대신 파일명을 노출). */
  currentName?: string | null;
  /** 파일 input 위에 붙는 라벨(예: 문서 새로 갱신하기). 미지정 시 숨김. */
  updateLabel?: string;
  /** 새로 선택한 파일(미저장). */
  selectedFile?: File | null;
  onSelect: (file: File | null) => void;
  /** 현재 첨부 보기(Signed URL 등). 없으면 보기 버튼 숨김. */
  onView?: () => void;
  viewing?: boolean;
  /** 현재 첨부 해제 요청 토글. */
  removeRequested?: boolean;
  onRemoveChange?: (remove: boolean) => void;
  error?: string | null;
  disabled?: boolean;
}

/**
 * 단일 파일 첨부 필드 (9-B): 선택·현재 보기·해제·검증 메시지를 표준 레이아웃으로 묶는다.
 * 검증 자체(형식/용량)는 호출부에서 수행해 error 로 전달한다.
 * 다중 사진 촬영/갤러리는 PhotoPicker 를 사용한다.
 */
export function FileUploadField({
  label,
  hint,
  accept,
  hasCurrent = false,
  currentName = null,
  updateLabel,
  selectedFile = null,
  onSelect,
  onView,
  viewing = false,
  removeRequested = false,
  onRemoveChange,
  error = null,
  disabled = false,
}: FileUploadFieldProps) {
  const showCurrent = hasCurrent && !removeRequested && !selectedFile;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-neutral-base">{label}</span>
        {hint && <span className="text-xs text-neutral-base/60">{hint}</span>}
      </div>

      {showCurrent && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          {currentName ? (
            <span className="min-w-0 break-all font-medium text-neutral-base">
              📄 {currentName}
            </span>
          ) : (
            <span className="font-medium text-neutral-base">현재 {label}가 첨부되어 있습니다.</span>
          )}
          {onView && (
            <Button type="button" variant="outline" size="sm" onClick={onView} loading={viewing}>
              보기
            </Button>
          )}
          {onRemoveChange && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onRemoveChange(true)}>
              <span className="text-brand">첨부 해제</span>
            </Button>
          )}
        </div>
      )}

      {removeRequested && !selectedFile && onRemoveChange && (
        <div className="flex items-center justify-between rounded-lg border border-danger-border bg-danger-surface px-3 py-2 text-sm">
          <span className="font-medium text-danger">저장 시 기존 {label}를 삭제합니다.</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onRemoveChange(false)}>
            취소
          </Button>
        </div>
      )}

      {updateLabel && (
        <span className="text-sm font-medium text-neutral-base">{updateLabel}</span>
      )}

      <input
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(e) => onSelect(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-neutral-base file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-raised file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-neutral-base hover:file:bg-surface"
      />
      {selectedFile && (
        <p className="text-xs text-neutral-base/70">
          선택됨: {selectedFile.name} ({Math.ceil(selectedFile.size / 1024)}KB) — 저장 시 업로드됩니다.
        </p>
      )}
      {error && <p className="text-sm font-medium text-brand">{error}</p>}
    </div>
  );
}
