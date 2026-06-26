/**
 * 퍼센트 막대용 정적 Tailwind width 클래스(인라인 스타일 금지 대응).
 * Tailwind JIT 가 리터럴을 수집하도록 5% 버킷의 클래스를 미리 나열한다.
 * (BookingStatsPanel 의 BAR_WIDTH_CLASS 와 동일 전략을 공용화)
 */
const BAR_WIDTH_CLASS: Record<number, string> = {
  0: 'w-[0%]',
  5: 'w-[5%]',
  10: 'w-[10%]',
  15: 'w-[15%]',
  20: 'w-[20%]',
  25: 'w-[25%]',
  30: 'w-[30%]',
  35: 'w-[35%]',
  40: 'w-[40%]',
  45: 'w-[45%]',
  50: 'w-[50%]',
  55: 'w-[55%]',
  60: 'w-[60%]',
  65: 'w-[65%]',
  70: 'w-[70%]',
  75: 'w-[75%]',
  80: 'w-[80%]',
  85: 'w-[85%]',
  90: 'w-[90%]',
  95: 'w-[95%]',
  100: 'w-[100%]',
};

/** 0~100(%) 을 가장 가까운 5% 버킷의 width 클래스로 변환. */
export function barWidthClass(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  return BAR_WIDTH_CLASS[Math.round(clamped / 5) * 5];
}
