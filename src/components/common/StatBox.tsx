/**
 * 통계 박스(중앙 정렬). 큰 값 + 작은 라벨(+선택 힌트)로 한 지표를 강조한다.
 * 예약 현황·진행 관리·상담/만족도 리포트의 "통계 카드 섹션"에서 grid 로 나열해 쓴다.
 * (StatCard 는 좌측 정렬 라벨+값 카드, StatBox 는 중앙 정렬 강조 박스로 용도가 다르다.)
 */
export function StatBox({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  hint?: string;
  /** 값 강조 색: 기본(중립) · 진행(info) · 양호(success) · 주의(warning). */
  tone?: 'default' | 'info' | 'success' | 'warning';
}) {
  const valueColor = {
    default: 'text-neutral-base',
    info: 'text-info',
    success: 'text-success',
    warning: 'text-[#e22213]',
  }[tone];
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-surface/40 px-3 py-4 text-center">
      <p className={`text-2xl font-extrabold leading-none ${valueColor}`}>
        {value}
        {hint && (
          <span className="ml-1 text-sm font-semibold text-neutral-base/60">
            {hint}
          </span>
        )}
      </p>
      <p className="mt-1.5 text-xs font-medium text-neutral-base/70">{label}</p>
    </div>
  );
}
