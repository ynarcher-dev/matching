/**
 * 현장 기업 사진 도메인 타입 (docs/staff_company_photo_upload.md, 0036_company_photos.sql).
 * 현장담당자(STAFF)/관리자(ADMIN)가 행사별 참가 기업(STARTUP)의 현장 사진을 누적 관리한다.
 */

/** company_photos 한 행(활성 사진만 조회 — deleted_at IS NULL). */
export interface CompanyPhotoRow {
  id: string;
  event_id: string;
  company_user_id: string;
  uploaded_by: string;
  storage_path: string;
  original_file_name: string | null;
  content_type: string | null;
  file_size: number | null;
  taken_at: string | null;
  created_at: string;
}

/** 업로드 대상 기업(행사 참가 STARTUP)의 표시 정보. */
export interface PhotoCompany {
  userId: string;
  /** 기업명(없으면 담당자명으로 폴백). */
  companyName: string;
  /** 검색·식별용 보조 텍스트(대표/담당자명). */
  contactName: string;
}

/** 기업별 사진 등록 현황(관리자 현황 탭·현장담당자 목록 공용). */
export interface CompanyPhotoStatus extends PhotoCompany {
  photoCount: number;
  /** 마지막 업로드 시각(ISO) 또는 null. */
  lastUploadedAt: string | null;
}

/** 행사 전체 사진 등록 현황 요약. */
export interface PhotoStatusSummary {
  totalCompanies: number;
  withPhotos: number;
  withoutPhotos: number;
  totalPhotos: number;
}
