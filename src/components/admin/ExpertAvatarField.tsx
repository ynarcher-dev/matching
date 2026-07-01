import { useEffect, useMemo, useState } from 'react';
import {
  BUCKET_SPEC,
  FILE_LABEL,
  createParticipantSignedUrl,
  validateParticipantFile,
} from '@/lib/storage';

interface ExpertAvatarFieldProps {
  /** 현재 저장된 프로필 사진 객체 경로(없으면 미업로드 — 기본 아이콘). */
  currentPath: string | null;
  /** 새로 선택한 파일(없으면 변경 없음). */
  file: File | null;
  onFileChange: (file: File | null) => void;
  /** 기존 사진 제거 요청 여부. */
  removeRequested: boolean;
  onRemoveChange: (remove: boolean) => void;
}

/** 기본값: 원형 사람 모양 아이콘(사진 미업로드 시 표시). */
function DefaultPersonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="h-16 w-16 text-neutral-base/30"
    >
      <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z" />
    </svg>
  );
}

/**
 * 전문가 프로필 사진 읽기 전용 원형 뷰(상세 모달 등).
 * 비공개 avatars 버킷이라 Signed URL 로 불러오고, 미업로드면 기본 사람 아이콘을 보여준다.
 * 편집 모달의 미리보기와 동일한 크기·형태(원형 128px)로 렌더한다.
 */
export function ExpertAvatarView({ path }: { path: string | null }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setSignedUrl(null);
      return;
    }
    createParticipantSignedUrl(path, 300)
      .then((url) => {
        if (!cancelled) setSignedUrl(url);
      })
      .catch(() => {
        if (!cancelled) setSignedUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <div className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface">
      {signedUrl ? (
        <img src={signedUrl} alt="전문가 프로필 사진" className="h-full w-full object-cover" />
      ) : (
        <DefaultPersonIcon />
      )}
    </div>
  );
}

/**
 * 전문가 프로필 사진 입력 (page_admin_user_management.md §2.4).
 * 원형 미리보기(사진 없으면 기본 사람 아이콘) + 사진 선택/변경/제거.
 * 비공개 avatars 버킷이라 현재 사진은 Signed URL 로 미리 본다.
 */
export function ExpertAvatarField({
  currentPath,
  file,
  onFileChange,
  removeRequested,
  onRemoveChange,
}: ExpertAvatarFieldProps) {
  const spec = BUCKET_SPEC.EXPERT;
  const [error, setError] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  // 새로 고른 파일은 objectURL 로, 기존 사진은 Signed URL 로 미리 본다.
  const previewFromFile = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (previewFromFile) URL.revokeObjectURL(previewFromFile);
    };
  }, [previewFromFile]);

  useEffect(() => {
    let cancelled = false;
    if (!currentPath || removeRequested) {
      setSignedUrl(null);
      return;
    }
    createParticipantSignedUrl(currentPath, 300)
      .then((url) => {
        if (!cancelled) setSignedUrl(url);
      })
      .catch(() => {
        if (!cancelled) setSignedUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentPath, removeRequested]);

  const previewUrl = previewFromFile ?? signedUrl;
  const hasImage = Boolean(previewUrl);

  const handleSelect = (selected: File | null) => {
    setError(null);
    if (!selected) {
      onFileChange(null);
      return;
    }
    const msg = validateParticipantFile('EXPERT', selected);
    if (msg) {
      setError(msg);
      onFileChange(null);
      return;
    }
    onRemoveChange(false);
    onFileChange(selected);
  };

  const handleRemove = () => {
    setError(null);
    onFileChange(null);
    // 저장된 사진이 있으면 제거 요청으로, 새로 고른 파일만 취소한 경우는 요청 없이 원복.
    onRemoveChange(Boolean(currentPath));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-neutral-base">{FILE_LABEL.EXPERT}</span>
      <div className="flex items-center gap-4">
        <div className="flex h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface">
          {hasImage ? (
            <img src={previewUrl!} alt="전문가 프로필 미리보기" className="h-full w-full object-cover" />
          ) : (
            <DefaultPersonIcon />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <label className="cursor-pointer rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-neutral-base transition-colors hover:bg-muted">
              {hasImage ? '사진 변경' : '사진 선택'}
              <input
                type="file"
                accept={spec.acceptAttr}
                className="hidden"
                onChange={(e) => handleSelect(e.target.files?.[0] ?? null)}
              />
            </label>
            {hasImage && (
              <button
                type="button"
                onClick={handleRemove}
                className="rounded-md px-2 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10"
              >
                제거
              </button>
            )}
          </div>
          <span className="text-xs text-neutral-base/50">{spec.hint}</span>
        </div>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
