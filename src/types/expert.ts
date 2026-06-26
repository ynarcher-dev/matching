/**
 * 전문가 대시보드 도메인 타입 (docs/page_expert_dashboard.md §1~2).
 * 본인 시간표·활성 세션 카드·디지털 상담일지에서 쓰는 경량 모델.
 * 전문가도 OTP 커스텀 JWT 경로이므로 조회/RPC 는 participantClient 를 쓴다.
 */

/** 활성 세션 카드에 노출할 스타트업 요약(users 일부, RLS 가 co-participant 로 허용). */
export interface SlotStartup {
  id: string;
  name: string;
  companyName: string | null;
  representativeName: string | null;
  description: string | null;
  /** 사업소개서 PDF 의 Storage 객체 경로(`proposals/...`). Signed URL 로만 열람. */
  proposalFileUrl: string | null;
}

/** counseling_logs 한 행 (db_schema §2.9). 임시저장 시 점수는 NULL 가능. */
export interface CounselingLogRow {
  id: string;
  matching_slot_id: string;
  score_technology: number | null;
  score_expertise: number | null;
  score_reliability: number | null;
  score_collaboration: number | null;
  score_probability: number | null;
  content: string | null;
  follow_up_required: boolean;
  follow_up_memo: string | null;
  is_public: boolean;
  submitted_at: string | null;
  updated_at: string | null;
}
