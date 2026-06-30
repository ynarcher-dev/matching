import type { CellState } from '@/lib/startupBooking';
import { SOLID_TONE } from '@/lib/tone';

/**
 * 슬롯 표시 상태별 색/라벨(전문가별·시간대별 보기 공통).
 * 내 예약=채운 success(✓), 신청 가능=연한 success(채움 vs 연함). 마감/신청 불가=동일 회색.
 * 9-A: 예약 가능/내 예약은 success tone 으로 통일(직접 emerald 색 금지).
 * Tailwind 클래스 상수만 모아 react-refresh 경고 없이 컴포넌트 간 재사용한다.
 */
export const CELL: Record<CellState, { box: string; label: string }> = {
  open: { box: 'cursor-pointer bg-surface-raised text-success hover:bg-success-surface', label: '신청 가능' },
  mine: { box: SOLID_TONE.success, label: '✓ 내 예약' },
  taken: { box: 'bg-surface text-neutral-base/40', label: '마감' },
  blocked: { box: 'bg-surface text-neutral-base/40', label: '신청 불가' },
  none: { box: '', label: '·' },
};
