import { useEffect, useState } from 'react';
import { Alert } from '@/components/common/Alert';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { PhotoPicker } from '@/components/common/PhotoPicker';
import { toast } from '@/stores/toastStore';
import {
  PHOTO_ACCEPT_ATTR,
  PHOTO_MAX_PER_COMPANY,
  validatePhotoFile,
} from '@/lib/companyPhoto';
import {
  useDeleteCompanyPhoto,
  usePhotoSignedUrls,
  useUploadCompanyPhotos,
} from '@/hooks/useCompanyPhotos';
import type { CompanyPhotoRow, PhotoCompany } from '@/types/companyPhoto';

interface PendingItem {
  file: File;
  url: string;
}

/**
 * 한 기업의 현장 사진 업로드/조회 패널 (docs/staff_company_photo_upload.md §3).
 * [사진 촬영](`capture="environment"`) / [앨범에서 선택](`multiple`) 버튼으로 추가 → 미리보기 → 일괄 업로드.
 * 기존 사진은 Signed URL 썸네일로 보여주고 삭제(soft delete)할 수 있다.
 */
export function CompanyPhotoUploadPanel({
  eventId,
  company,
  photos,
}: {
  eventId: string;
  company: PhotoCompany;
  photos: CompanyPhotoRow[];
}) {
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<CompanyPhotoRow | null>(null);

  const upload = useUploadCompanyPhotos(eventId);
  const remove = useDeleteCompanyPhoto(eventId);
  const signed = usePhotoSignedUrls(
    eventId,
    photos.map((p) => p.storage_path),
  );

  // 미리보기 objectURL 정리(언마운트·기업 전환 시).
  useEffect(() => {
    return () => pending.forEach((p) => URL.revokeObjectURL(p.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetPending = () => {
    pending.forEach((p) => URL.revokeObjectURL(p.url));
    setPending([]);
  };

  const onPick = (list: FileList | null) => {
    setLocalError(null);
    if (!list || list.length === 0) return;
    const remaining = PHOTO_MAX_PER_COMPANY - photos.length - pending.length;
    const next: PendingItem[] = [];
    for (const file of Array.from(list)) {
      if (next.length >= remaining) {
        setLocalError(`기업당 최대 ${PHOTO_MAX_PER_COMPANY}장까지 등록할 수 있습니다.`);
        break;
      }
      const err = validatePhotoFile(file);
      if (err) {
        setLocalError(err);
        continue;
      }
      next.push({ file, url: URL.createObjectURL(file) });
    }
    setPending((cur) => [...cur, ...next]);
  };

  const removePending = (idx: number) => {
    setPending((cur) => {
      const item = cur[idx];
      if (item) URL.revokeObjectURL(item.url);
      return cur.filter((_, i) => i !== idx);
    });
  };

  const onUpload = async () => {
    if (pending.length === 0) return;
    try {
      const res = await upload.mutateAsync({
        companyUserId: company.userId,
        files: pending.map((p) => p.file),
      });
      resetPending();
      if (res.failed > 0) {
        toast.warning(`사진 ${res.uploaded}장을 업로드했고 ${res.failed}장은 실패했습니다.`, {
          description: '실패분은 다시 시도해 주세요.',
        });
      } else {
        toast.success(`사진 ${res.uploaded}장을 업로드했습니다.`);
      }
    } catch (e) {
      toast.error('사진을 업로드하지 못했습니다.', { description: (e as Error).message });
    }
  };

  const urlMap = signed.data ?? new Map<string, string>();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-base font-bold text-neutral-base">{company.companyName}</h3>
        <p className="text-xs text-neutral-base/70">{company.contactName}</p>
      </div>

      <PhotoPicker
        accept={PHOTO_ACCEPT_ATTR}
        onPick={onPick}
        pending={pending}
        onRemovePending={removePending}
        onUpload={onUpload}
        uploading={upload.isPending}
      />

      {localError && <Alert tone="error">{localError}</Alert>}

      {/* 등록된 사진 */}
      <div>
        <p className="mb-1.5 text-sm font-semibold text-neutral-base">등록된 사진 {photos.length}장</p>
        {photos.length === 0 ? (
          <p className="rounded-lg bg-surface px-3 py-6 text-center text-sm text-neutral-base">
            아직 등록된 사진이 없습니다.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {photos.map((photo) => {
              const url = urlMap.get(photo.storage_path);
              return (
                <div
                  key={photo.id}
                  className="relative aspect-square overflow-hidden rounded-lg border border-border bg-surface"
                >
                  {url ? (
                    <img src={url} alt={photo.original_file_name ?? ''} className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-xs text-neutral-base/60">
                      {signed.isLoading ? '불러오는 중…' : '미리보기 없음'}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setToDelete(photo)}
                    className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs font-bold text-white"
                    aria-label="사진 삭제"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmModal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="사진 삭제"
        message="선택한 사진을 삭제합니다. 되돌릴 수 없습니다."
        confirmLabel="삭제"
        loading={remove.isPending}
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await remove.mutateAsync(toDelete);
            setToDelete(null);
          } catch {
            toast.error('삭제에 실패했습니다. 다시 시도해 주세요.');
          }
        }}
      />
    </div>
  );
}
