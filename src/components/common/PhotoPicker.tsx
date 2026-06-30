import { useRef } from 'react';
import { Button } from '@/components/common/Button';

export interface PendingPhoto {
  /** 미리보기 objectURL(고유 key 로도 사용). */
  url: string;
}

interface PhotoPickerProps {
  accept: string;
  /** 카메라/갤러리에서 선택된 파일. */
  onPick: (files: FileList | null) => void;
  /** 업로드 대기 미리보기 목록. */
  pending: PendingPhoto[];
  onRemovePending: (index: number) => void;
  /** 업로드 실행. pending 이 있을 때만 버튼 노출. */
  onUpload: () => void;
  uploading?: boolean;
  disabled?: boolean;
}

/**
 * 현장 사진 촬영/갤러리 선택 + 업로드 대기 미리보기 (9-B).
 * [사진 촬영](capture="environment") / [앨범에서 선택](multiple) 두 input 을 숨기고
 * 버튼으로 트리거한다. 업로드/삭제 등 데이터 처리는 호출부 콜백이 담당한다.
 */
export function PhotoPicker({
  accept,
  onPick,
  pending,
  onRemovePending,
  onUpload,
  uploading = false,
  disabled = false,
}: PhotoPickerProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const handlePick = (list: FileList | null) => {
    onPick(list);
    if (cameraRef.current) cameraRef.current.value = '';
    if (galleryRef.current) galleryRef.current.value = '';
  };

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={cameraRef}
        type="file"
        accept={accept}
        capture="environment"
        className="hidden"
        onChange={(e) => handlePick(e.target.files)}
      />
      <input
        ref={galleryRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => handlePick(e.target.files)}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={disabled} onClick={() => cameraRef.current?.click()}>
          사진 촬영
        </Button>
        <Button variant="outline" disabled={disabled} onClick={() => galleryRef.current?.click()}>
          앨범에서 선택
        </Button>
        {pending.length > 0 && (
          <Button onClick={onUpload} loading={uploading} disabled={disabled}>
            {pending.length}장 업로드
          </Button>
        )}
      </div>

      {pending.length > 0 && (
        <div>
          <p className="mb-1.5 text-sm font-semibold text-neutral-base">
            업로드 대기 {pending.length}장
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {pending.map((p, i) => (
              <div
                key={p.url}
                className="relative aspect-square overflow-hidden rounded-lg border border-border"
              >
                <img src={p.url} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => onRemovePending(i)}
                  className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs font-bold text-white"
                  aria-label="대기 사진 제거"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
