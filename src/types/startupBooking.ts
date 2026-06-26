/**
 * 스타트업 예약 포탈 도메인 타입 (page_startup_booking.md).
 * 참가자(STARTUP) 커스텀 JWT 경로에서 쓰는 행 모델. 슬롯/행사 행은 기존 타입을 재사용한다.
 */

import type { MatchingSlotRow } from '@/types/eventDetail';

/** 행사에 참가한 전문가 1명 + 프로필·분야·기본 테이블. */
export interface PortalExpert {
  userId: string;
  name: string;
  organization: string | null;
  position: string | null;
  description: string | null;
  defaultTableId: string | null;
  /** 전문가의 관심/전문 분야명(user_fields → fields.name, 최대 3개). */
  fieldNames: string[];
}

/** 내 예약 1건(카드 표시용 — 슬롯 + 전문가 + 적용 테이블 코드). */
export interface MyBooking {
  slot: MatchingSlotRow;
  expert: PortalExpert | undefined;
  tableCode: string | null;
}
