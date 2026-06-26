import { supabase } from '@/lib/supabaseClient';
import type {
  CompanyPhotoRow,
  CompanyPhotoStatus,
  PhotoCompany,
  PhotoStatusSummary,
} from '@/types/companyPhoto';

/**
 * 현장 기업 사진 Storage·집계 헬퍼 (docs/staff_company_photo_upload.md, 0036).
 * 비공개 버킷 `event-photos` + 권한이 적용된 Signed URL 로만 제공한다(공개 URL 금지).
 * 경로 규칙(0007 _storage_owner_id 정합): `event-photos/{event_id}/{company_user_id}/{uuid}.{ext}`
 *   → foldername()[2] = company_user_id 가 소유 기업.
 */

export const PHOTO_BUCKET = 'event-photos';

/** 허용 이미지 MIME. */
export const PHOTO_ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
/** 파일 입력 accept 속성(모바일 카메라 호출). */
export const PHOTO_ACCEPT_ATTR = 'image/*';
/** 리사이즈 후 업로드 1장당 최대 바이트(안전 상한). */
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024; // 8MB
/** 기업당 최대 사진 수. */
export const PHOTO_MAX_PER_COMPANY = 30;
/** 리사이즈 목표(긴 변 px) / JPEG 품질. */
const RESIZE_MAX_EDGE = 1600;
const RESIZE_QUALITY = 0.82;

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** 업로드 전 클라이언트 검증. 통과하면 null, 실패하면 사용자 메시지(원본 파일 기준). */
export function validatePhotoFile(file: File): string | null {
  if (!file.type.startsWith('image/')) {
    return '이미지 파일만 업로드할 수 있습니다.';
  }
  if (file.size > PHOTO_MAX_BYTES) {
    return '사진 용량이 너무 큽니다 (최대 8MB).';
  }
  return null;
}

/** 객체 키(버킷 제외)를 만든다: `{event_id}/{company_user_id}/{uuid}.{ext}`. */
export function buildPhotoObjectKey(
  eventId: string,
  companyUserId: string,
  contentType: string,
): string {
  const ext = EXT_BY_TYPE[contentType] ?? 'jpg';
  return `${eventId}/${companyUserId}/${crypto.randomUUID()}.${ext}`;
}

/**
 * 이미지를 캔버스로 리사이즈/재인코딩해 업로드 용량을 줄인다(JPEG).
 * 디코드 실패 등으로 변환이 어려우면 원본 파일을 그대로 반환한다(폴백).
 */
export async function resizeImageFile(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, RESIZE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', RESIZE_QUALITY),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

/** 저장된 객체 경로(`event-photos/...`)의 단기 Signed URL 을 만든다(운영진 클라이언트). */
export async function createPhotoSignedUrl(path: string, expiresInSec = 300): Promise<string> {
  const objectKey = path.slice(PHOTO_BUCKET.length + 1);
  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(objectKey, expiresInSec);
  if (error || !data) throw new Error(`사진 링크 생성에 실패했습니다: ${error?.message ?? ''}`);
  return data.signedUrl;
}

/** 여러 객체 경로의 Signed URL 을 한 번에 만든다(경로→URL 맵). */
export async function createPhotoSignedUrls(
  paths: string[],
  expiresInSec = 300,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (paths.length === 0) return map;
  const keys = paths.map((p) => p.slice(PHOTO_BUCKET.length + 1));
  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(keys, expiresInSec);
  if (error || !data) throw new Error(`사진 링크 생성에 실패했습니다: ${error?.message ?? ''}`);
  data.forEach((d, i) => {
    if (d.signedUrl) map.set(paths[i], d.signedUrl);
  });
  return map;
}

/**
 * 기업 목록 + 활성 사진 행으로 기업별 등록 현황을 만든다(순수 함수).
 * 사진 0장 기업도 포함하며, 기업명 오름차순으로 정렬한다.
 */
export function buildCompanyStatuses(
  companies: PhotoCompany[],
  photos: Pick<CompanyPhotoRow, 'company_user_id' | 'created_at'>[],
): CompanyPhotoStatus[] {
  const agg = new Map<string, { count: number; last: string | null }>();
  for (const p of photos) {
    const cur = agg.get(p.company_user_id) ?? { count: 0, last: null };
    cur.count += 1;
    if (!cur.last || p.created_at > cur.last) cur.last = p.created_at;
    agg.set(p.company_user_id, cur);
  }
  return companies
    .map((c) => {
      const a = agg.get(c.userId);
      return {
        ...c,
        photoCount: a?.count ?? 0,
        lastUploadedAt: a?.last ?? null,
      };
    })
    .sort((a, b) => a.companyName.localeCompare(b.companyName, 'ko'));
}

/** 기업별 현황에서 행사 전체 요약을 만든다(순수 함수). */
export function summarizePhotoStatus(statuses: CompanyPhotoStatus[]): PhotoStatusSummary {
  const withPhotos = statuses.filter((s) => s.photoCount > 0).length;
  return {
    totalCompanies: statuses.length,
    withPhotos,
    withoutPhotos: statuses.length - withPhotos,
    totalPhotos: statuses.reduce((sum, s) => sum + s.photoCount, 0),
  };
}

/** 검색어로 기업 현황을 필터링한다(기업명/담당자명 부분일치, 순수 함수). */
export function filterCompanyStatuses(
  statuses: CompanyPhotoStatus[],
  query: string,
): CompanyPhotoStatus[] {
  const q = query.trim().toLowerCase();
  if (!q) return statuses;
  return statuses.filter(
    (s) =>
      s.companyName.toLowerCase().includes(q) || s.contactName.toLowerCase().includes(q),
  );
}
