import { AttendanceSegmentedControl } from '@/components/common/AttendanceSegmentedControl';
import type { AttendanceStatus } from '@/types/attendance';

/**
 * 3단 출석 세그먼트 [미정 | 출석 | 불참] (docs/page_expert_dashboard.md §2.4).
 * 9-G: 공통 `AttendanceSegmentedControl` 로 위임해 관리자 진행 화면과 규칙을 공유한다.
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
  return (
    <AttendanceSegmentedControl
      label={label}
      status={status}
      disabled={disabled}
      onChange={(next) => (next === null ? onClear() : onSet(next))}
    />
  );
}
