import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { useAuthStore } from '@/stores/authStore';
import {
  PHOTO_BUCKET,
  buildPhotoObjectKey,
  createPhotoSignedUrls,
  resizeImageFile,
} from '@/lib/companyPhoto';
import type { CompanyPhotoRow } from '@/types/companyPhoto';

/**
 * 현장 기업 사진 조회/업로드/삭제 (docs/staff_company_photo_upload.md, 0036).
 * 현장담당자·관리자 모두 operator(`supabase`) 클라이언트 — RLS 가 권한을 게이트한다.
 */

const PHOTO_COLUMNS =
  'id,event_id,company_user_id,uploaded_by,storage_path,original_file_name,' +
  'content_type,file_size,taken_at,created_at';

export const companyPhotoKeys = {
  root: (eventId: string) => ['company-photos', eventId] as const,
  list: (eventId: string) => [...companyPhotoKeys.root(eventId), 'list'] as const,
  signed: (eventId: string, paths: string[]) =>
    [...companyPhotoKeys.root(eventId), 'signed', paths] as const,
};

/** 행사 전체의 활성 사진 행(현황 집계·기업별 그리드 공용). */
export function useEventCompanyPhotos(eventId: string) {
  return useQuery<CompanyPhotoRow[]>({
    queryKey: companyPhotoKeys.list(eventId),
    enabled: !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_photos')
        .select(PHOTO_COLUMNS)
        .eq('event_id', eventId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .returns<CompanyPhotoRow[]>();
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** 객체 경로 목록의 Signed URL 맵(썸네일 표시용, 5분 만료). */
export function usePhotoSignedUrls(eventId: string, paths: string[]) {
  return useQuery<Map<string, string>>({
    queryKey: companyPhotoKeys.signed(eventId, paths),
    enabled: paths.length > 0,
    staleTime: 1000 * 60 * 4, // 만료(5분)보다 짧게 캐시
    queryFn: () => createPhotoSignedUrls(paths),
  });
}

/**
 * 한 기업에 사진 여러 장 업로드 — 각 파일을 리사이즈 → 스토리지 업로드 → 행 INSERT.
 * 일부 실패해도 성공분은 반영하고, 실패 건수를 반환한다(부분 성공).
 */
export function useUploadCompanyPhotos(eventId: string) {
  const qc = useQueryClient();
  const uploaderId = useAuthStore((s) => s.user?.id ?? '');
  return useMutation({
    mutationFn: async ({ companyUserId, files }: { companyUserId: string; files: File[] }) => {
      let uploaded = 0;
      const failures: string[] = [];
      for (const file of files) {
        try {
          const blob = await resizeImageFile(file);
          const contentType = blob.type || file.type || 'image/jpeg';
          const objectKey = buildPhotoObjectKey(eventId, companyUserId, contentType);
          const { error: upErr } = await supabase.storage
            .from(PHOTO_BUCKET)
            .upload(objectKey, blob, { contentType, upsert: false });
          if (upErr) throw upErr;

          const { error: rowErr } = await supabase.from('company_photos').insert({
            event_id: eventId,
            company_user_id: companyUserId,
            uploaded_by: uploaderId,
            storage_path: `${PHOTO_BUCKET}/${objectKey}`,
            original_file_name: file.name,
            content_type: contentType,
            file_size: blob.size,
          });
          if (rowErr) {
            // 행 INSERT 실패 시 방금 올린 객체 정리(고아 방지).
            await supabase.storage.from(PHOTO_BUCKET).remove([objectKey]);
            throw rowErr;
          }
          uploaded += 1;
        } catch (e) {
          failures.push((e as Error).message);
        }
      }
      return { uploaded, failed: failures.length };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: companyPhotoKeys.root(eventId) });
    },
  });
}

/** 사진 1장 삭제 — soft delete(deleted_at) + 스토리지 객체 제거(용량 절감). */
export function useDeleteCompanyPhoto(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (photo: CompanyPhotoRow) => {
      const { error } = await supabase
        .from('company_photos')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', photo.id);
      if (error) throw error;
      // 행 soft delete 성공 후 객체 제거(실패해도 행은 이미 숨겨져 무방).
      const objectKey = photo.storage_path.slice(PHOTO_BUCKET.length + 1);
      await supabase.storage.from(PHOTO_BUCKET).remove([objectKey]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: companyPhotoKeys.root(eventId) });
    },
  });
}
