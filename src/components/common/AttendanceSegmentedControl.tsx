import { SegmentedControl, type SegmentOption } from '@/components/common/SegmentedControl';
import type { AttendanceStatus } from '@/types/attendance';

/** 내부 세그먼트 값(null=미정 → 'NONE'). */
type AttendanceSegValue = 'NONE' | 'PRESENT' | 'ABSENT';

const VALUE_TO_STATUS: Record<AttendanceSegValue, AttendanceStatus | null> = {
  NONE: null,
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
};

interface AttendanceSegmentedControlProps {
  /** 좌측/상단 라벨(예: 전문가/스타트업). */
  label?: string;
  status: AttendanceStatus | null;
  onChange: (next: AttendanceStatus | null) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** 라벨 배치: stack(위)·inline(좌측 고정폭). */
  layout?: 'stack' | 'inline';
  /** 라벨 + 마크 동시 표기 여부(sm 그리드에서는 마크만 쓰기 좋게 false). */
  showText?: boolean;
}

/**
 * 출석 3단 세그먼트 [미정 | 출석 | 불참] 공통 컴포넌트 (9-G).
 * 관리자 진행 대시보드(TimeGridSheet)와 전문가 화면이 같은 규칙을 공유한다.
 * 미정=muted / 출석=success / 불참=danger tone(9-A), 실수 시 미정으로 복구.
 */
export function AttendanceSegmentedControl({
  label,
  status,
  onChange,
  disabled = false,
  size = 'md',
  layout = 'stack',
  showText = true,
}: AttendanceSegmentedControlProps) {
  const value: AttendanceSegValue =
    status === 'PRESENT' ? 'PRESENT' : status === 'ABSENT' ? 'ABSENT' : 'NONE';

  const options: SegmentOption<AttendanceSegValue>[] = [
    { value: 'NONE', label: showText ? '미정' : '–', title: '미정', activeTone: 'muted' },
    {
      value: 'PRESENT',
      label: showText ? '✓ 출석' : '✓',
      title: '출석',
      activeTone: 'success',
    },
    { value: 'ABSENT', label: showText ? '✕ 불참' : '✕', title: '불참', activeTone: 'danger' },
  ];

  const control = (
    <SegmentedControl<AttendanceSegValue>
      value={value}
      options={options}
      onChange={(v) => onChange(VALUE_TO_STATUS[v])}
      ariaLabel={label ? `${label} 출석 상태` : '출석 상태'}
      size={size}
      disabled={disabled}
      className={layout === 'inline' ? 'flex-1' : 'w-full'}
    />
  );

  if (!label) return control;

  if (layout === 'inline') {
    return (
      <div className="flex items-center gap-1">
        <span className="w-10 shrink-0 text-[10px] font-semibold text-neutral-base/70">{label}</span>
        {control}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-neutral-base/60">{label}</span>
      {control}
    </div>
  );
}
