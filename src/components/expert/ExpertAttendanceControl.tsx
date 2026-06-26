import type { AttendanceStatus } from '@/types/attendance';

/**
 * 3단 출석 세그먼트 [미정 | 출석 | 불참] (docs/page_expert_dashboard.md §2.4).
 * 관리자 진행 대시보드(TimeGridSheet)와 동일한 조작 모델: 실수로 누른 경우 '미정'으로 복구.
 * - 미정(null) = clear_attendance 로 로그 삭제
 * - 출석(PRESENT)/불참(ABSENT) = check_in 으로 기록
 */
export function ExpertAttendanceControl({
  label,
  status,
  onSet,
  onClear,
  disabled = false,
}: {
  label: string;
  status: AttendanceStatus | null;
  onSet: (status: AttendanceStatus) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const seg = (active: boolean, tone: string) =>
    `flex-1 px-3 py-2 text-sm font-semibold transition-colors ${
      active ? tone : 'bg-white text-neutral-base/70'
    } ${disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-surface'}`;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-neutral-base/60">{label}</span>
      <div className="inline-flex overflow-hidden rounded-lg border border-border">
        <button
          type="button"
          disabled={disabled}
          aria-pressed={status === null}
          onClick={onClear}
          className={`${seg(status === null, 'bg-neutral-base/10 text-neutral-base')} border-r border-border`}
        >
          미정
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={status === 'PRESENT'}
          onClick={() => onSet('PRESENT')}
          className={`${seg(status === 'PRESENT', 'bg-emerald-500 text-white')} border-r border-border`}
        >
          ✓ 출석
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={status === 'ABSENT'}
          onClick={() => onSet('ABSENT')}
          className={seg(status === 'ABSENT', 'bg-brand text-white')}
        >
          ✕ 불참
        </button>
      </div>
    </div>
  );
}
