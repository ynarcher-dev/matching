/**
 * 9-A 디자인 토큰 — 상태 의미별 tone map (uiux_rework_09_a_design_tokens.md §4·§6).
 *
 * 화면마다 emerald/blue/violet/amber 같은 Tailwind 색을 직접 쓰던 것을 의미 tone 으로 모은다.
 * 같은 의미(완료·실패·진행 중…)는 어느 화면에서든 같은 tone → 같은 색으로 보이도록,
 * 상태 배지/세그먼트/슬롯이 이 맵을 공유한다. 색상 토큰 자체는 src/index.css @theme 에 정의.
 */
export type Tone =
  | 'brand'
  | 'neutral'
  | 'muted'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'ai';

/**
 * 흰 배경 + 부드러운 경계 + 진한 텍스트.
 * 상태 배지·칩·태그 등 "읽기용" 상태 표시에 사용한다.
 */
export const BADGE_TONE: Record<Tone, string> = {
  brand: 'border-brand/30 bg-brand/5 text-brand',
  neutral: 'border-border bg-surface text-neutral-base',
  muted: 'border-border bg-muted/50 text-neutral-base/60',
  success: 'border-success-border bg-success-surface text-success',
  warning: 'border-warning-border bg-warning-surface text-warning',
  danger: 'border-danger-border bg-danger-surface text-danger',
  info: 'border-info-border bg-info-surface text-info',
  ai: 'border-ai-border bg-ai-surface text-ai',
};

/**
 * 채운 배경 + 흰 텍스트.
 * 활성 세그먼트·강조 선택(내 예약, 출석 선택 등) 등 "선택됨"을 강조할 때 사용한다.
 */
export const SOLID_TONE: Record<Tone, string> = {
  brand: 'bg-brand text-white',
  neutral: 'bg-neutral-base text-white',
  muted: 'bg-neutral-base/10 text-neutral-base',
  success: 'bg-success text-white',
  warning: 'bg-warning text-white',
  danger: 'bg-danger text-white',
  info: 'bg-info text-white',
  ai: 'bg-ai text-white',
};

/** 배지 tone 클래스 조회 헬퍼(맵 직접 접근과 동일, 호출부 가독성용). */
export function badgeTone(tone: Tone): string {
  return BADGE_TONE[tone];
}

/** 채움 tone 클래스 조회 헬퍼. */
export function solidTone(tone: Tone): string {
  return SOLID_TONE[tone];
}
