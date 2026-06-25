/**
 * 참가자(전문가/스타트업) 도메인 타입 (docs/db_schema.md §2.2, page_admin_user_management.md).
 * 관리자 참가자 DB 관리 화면에서 쓰는 컬럼 + 인증 개요(최근 OTP 상태·긴급토큰)를 모델링한다.
 * 슬라이스 3: 분야(M:N, field_ids)·Storage 파일(소개서 PDF/프로필 사진) 컬럼 포함.
 */

/** 참가자 역할(운영진/스태프 제외). */
export type ParticipantRole = 'EXPERT' | 'STARTUP';

/** 분야 마스터 한 행 (docs/db_schema.md §2.3). */
export interface Field {
  id: string;
  name: string;
}

/** OTP 발송 채널(0009 chk_otp_channel). */
export type OtpChannel = 'EMAIL' | 'SMS' | 'ALIMTALK';

/** 인증 가능 채널(등록 연락처 보유 여부에서 도출). */
export type AuthChannel = 'EMAIL' | 'SMS';

/** 최근 OTP 발송 상태(admin_participant_auth_overview 도출값). */
export type OtpStatus = 'SENT' | 'USED' | 'EXPIRED' | 'INVALIDATED' | 'NONE';

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
  /** 전문가 프로필 사진의 Storage 객체 경로(`avatars/...`). */
  profile_image_url: string | null;
  session_version: number;
  created_at: string;
}

/** admin_participant_auth_overview RPC 한 행. */
export interface UserAuthOverview {
  user_id: string;
  otp_channel: OtpChannel | null;
  otp_status: OtpStatus;
  otp_requested_at: string | null;
  has_active_emergency: boolean;
}

/** 인증 개요가 병합된 참가자(테이블 행). */
export interface ParticipantWithAuth extends ParticipantRow {
  /** 등록 연락처로부터 도출한 인증 가능 채널. */
  channels: AuthChannel[];
  auth: UserAuthOverview | null;
  /** 사용자 기본 분야(user_fields) field_id 목록. 최대 3개. */
  field_ids: string[];
}
