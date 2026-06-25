import { useState } from 'react';
import { Button } from '@/components/common/Button';
import {
  BUCKET_SPEC,
  FILE_LABEL,
  createParticipantSignedUrl,
  validateParticipantFile,
} from '@/lib/storage';
import type { ParticipantRole } from '@/types/user';

interface ParticipantFileInputProps {
  role: ParticipantRole;
  /** 현재 저장된 파일 객체 경로(없으면 첨부 없음). */
  currentPath: string | null;
  /** 새로 선택한 파일(없으면 변경 없음). */
  file: File | null;
  onFileChange: (file: File | null) => void;
  /** 기존 파일 제거 요청 여부. */
  removeRequested: boolean;
  onRemoveChange: (remove: boolean) => void;
}

/**
 * 역할별 첨부 파일 입력 (page_admin_user_management.md §2.4).
 * 스타트업=사업소개서 PDF, 전문가=프로필 사진. 비공개 버킷 + Signed URL 보기.
 * 검증 실패 메시지는 내부에서 표시한다(폼 제출 전 차단).
 */
export function ParticipantFileInput({
  role,
  currentPath,
  file,
  onFileChange,
  removeRequested,
  onRemoveChange,
}: ParticipantFileInputProps) {
  const spec = BUCKET_SPEC[role];
  const label = FILE_LABEL[role];
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);

  const handleSelect = (selected: File | null) => {
    setError(null);
    if (!selected) {
      onFileChange(null);
      return;
    }
    const msg = validateParticipantFile(role, selected);
    if (msg) {
      setError(msg);
      onFileChange(null);
      return;
    }
    onRemoveChange(false);
    onFileChange(selected);
  };

  const openCurrent = async () => {
    if (!currentPath) return;
    setError(null);
    setViewing(true);
    try {
      const url = await createParticipantSignedUrl(currentPath, 120);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setViewing(false);
    }
  };

  const hasCurrent = Boolean(currentPath) && !removeRequested;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-neutral-base">{label}</span>
        <span className="text-xs text-neutral-base/60">{spec.hint}</span>
      </div>

      {/* 현재 첨부 상태 */}
      {hasCurrent && !file && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          <span className="font-medium text-neutral-base">현재 {label}가 첨부되어 있습니다.</span>
          <Button type="button" variant="outline" onClick={openCurrent} loading={viewing}>
            보기
          </Button>
          <button
            type="button"
            onClick={() => onRemoveChange(true)}
            className="rounded-md border border-border px-2 py-1 text-xs font-semibold text-brand hover:bg-danger-surface"
          >
            첨부 해제
          </button>
        </div>
      )}

      {removeRequested && !file && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-danger-surface px-3 py-2 text-sm">
          <span className="font-medium text-brand">저장 시 기존 {label}를 삭제합니다.</span>
          <button
            type="button"
            onClick={() => onRemoveChange(false)}
            className="rounded-md border border-border px-2 py-1 text-xs font-semibold text-neutral-base hover:bg-surface"
          >
            취소
          </button>
        </div>
      )}

      {/* 새 파일 선택 */}
      <input
        type="file"
        accept={spec.acceptAttr}
        onChange={(e) => handleSelect(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-neutral-base file:mr-3 file:rounded-md file:border file:border-border file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-neutral-base hover:file:bg-surface"
      />
      {file && (
        <p className="text-xs text-neutral-base/70">
          선택됨: {file.name} ({Math.ceil(file.size / 1024)}KB) — 저장 시 업로드됩니다.
        </p>
      )}
      {error && <p className="text-sm font-medium text-brand">{error}</p>}
    </div>
  );
}
