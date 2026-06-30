import { useMemo, useState } from 'react';
import { FileUploadField } from '@/components/common/FileUploadField';
import { useProposalHistory } from '@/hooks/useProposalHistory';
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
  /**
   * 대상 스타트업 user_id. 지정 시 소개서 변경 이력에서 현재 파일의 원본 파일명을 해석한다.
   * (Storage 경로는 `proposals/{userId}/{uuid}.pdf` 라 경로만으로는 파일명을 알 수 없음.)
   */
  userId?: string | null;
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
 * 9-B: 공통 FileUploadField 로 레이아웃을 위임하고, 역할별 검증·Signed URL 만 담당한다.
 */
export function ParticipantFileInput({
  role,
  currentPath,
  userId,
  file,
  onFileChange,
  removeRequested,
  onRemoveChange,
}: ParticipantFileInputProps) {
  const spec = BUCKET_SPEC[role];
  const label = FILE_LABEL[role];
  const isStartup = role === 'STARTUP';
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);

  // 스타트업 소개서: 변경 이력에서 현재 경로에 해당하는 원본 파일명을 해석한다.
  const { data: history } = useProposalHistory(
    userId ?? undefined,
    isStartup && Boolean(userId),
  );
  const currentName = useMemo(() => {
    if (!isStartup || !currentPath) return null;
    return (history ?? []).find((h) => h.file_path === currentPath)?.file_name ?? null;
  }, [isStartup, currentPath, history]);

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

  return (
    <FileUploadField
      label={label}
      hint={spec.hint}
      accept={spec.acceptAttr}
      hasCurrent={Boolean(currentPath)}
      currentName={currentName}
      updateLabel={isStartup ? '문서 새로 갱신하기' : undefined}
      selectedFile={file}
      onSelect={handleSelect}
      onView={currentPath ? openCurrent : undefined}
      viewing={viewing}
      removeRequested={removeRequested}
      onRemoveChange={onRemoveChange}
      error={error}
    />
  );
}
