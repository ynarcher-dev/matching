/**
 * 참가자(전문가/스타트업) 도메인 타입 (docs/db_schema.md §2.2, page_admin_user_management.md).
 * 관리자 참가자 DB 관리 화면에서 쓰는 컬럼을 모델링한다.
 * 슬라이스 3: 분야(M:N, field_ids)·Storage 파일(소개서 PDF/프로필 사진) 컬럼 포함.
 */

/** 참가자 역할(운영진/스태프 제외). */
export type ParticipantRole = 'EXPERT' | 'STARTUP';

/** 분야 마스터 한 행 (docs/db_schema.md §2.3). */
export interface Field {
  id: string;
  name: string;
}

/** 인증 가능 채널(등록 연락처 보유 여부에서 도출). */
export type AuthChannel = 'EMAIL' | 'SMS';

/** users 테이블 한 행(관리자 목록·폼에서 쓰는 컬럼). */
export interface ParticipantRow {
  id: string;
  email: string;
  name: string;
  role: ParticipantRole;
  phone_number: string | null;
  company_name: string | null;
  representative_name: string | null;
  contact_name: string | null;
  company_description: string | null;
  company_homepage: string | null;
  expert_organization: string | null;
  expert_position: string | null;
  expert_description: string | null;
  /** 스타트업 사업소개서 PDF 의 Storage 객체 경로(`proposals/...`). */
  proposal_file_url: string | null;
  /** 소개서 마지막 업로드 시각(0046 트리거 자동 기록). 첨부 없으면 null. */
  proposal_uploaded_at: string | null;
  /** 소개서 마지막 업로드 주체 user_id(관리자 대행 또는 본인). 확인 불가 시 null. */
  proposal_uploaded_by: string | null;
  /** 전문가 프로필 사진의 Storage 객체 경로(`avatars/...`). */
  profile_image_url: string | null;
  /** 무료 운영 로그인/긴급 링크 소비 시각(0046). 미로그인이면 null. */
  last_login_at: string | null;
  session_version: number;
  created_at: string;
}

/** 소개서 업로드 이력 액션(0052 proposal_uploads.action). */
export type ProposalUploadAction = 'UPLOAD' | 'REPLACE' | 'CLEAR';

/**
 * 스타트업 소개서 업로드 이력 한 행(타임라인, 0052 proposal_uploads).
 * 관리자 대행/본인 업로드 모두 한 건씩 적재되며, 과거 버전은 file_path 로 보기 가능하다.
 */
export interface ProposalUpload {
  id: string;
  user_id: string;
  action: ProposalUploadAction;
  /** 이 이력이 가리키는 Storage 객체 경로. CLEAR(해제)이면 null. */
  file_path: string | null;
  /** 업로드한 원본 파일명. 백필/확인 불가 시 null. */
  file_name: string | null;
  /** 파일 크기(바이트). 모르면 null. */
  file_size: number | null;
  uploaded_at: string;
  /** 업로드 주체 user_id. 확인 불가 시 null. */
  uploaded_by: string | null;
  /** 업로드 주체 이름(uploaded_by 해석). 확인 불가 시 null. */
  uploader_name: string | null;
}

/** 인증 개요가 병합된 참가자(테이블 행). */
export interface ParticipantWithAuth extends ParticipantRow {
  /** 등록 연락처로부터 도출한 인증 가능 채널. */
  channels: AuthChannel[];
  /** 사용자 기본 분야(user_fields) field_id 목록. 최대 3개. */
  field_ids: string[];
  /** 소개서 업로드 주체 이름(proposal_uploaded_by 해석). 확인 불가 시 null. */
  proposal_uploader_name: string | null;
}
