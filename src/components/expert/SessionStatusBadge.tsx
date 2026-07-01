import { Badge } from '@/components/common/Badge';
import { SESSION_STATUS_LABELS } from '@/lib/labels';
import type { Tone } from '@/lib/tone';
import type { SessionStatus } from '@/types/eventDetail';

/** 세션 상태별 의미 tone(아이콘+텍스트 병기, page_expert_dashboard.md §1.2 / 9-A 공통 tone). */
const STATUS_TONE: Record<SessionStatus, Tone> = {
  WAITING: 'muted',
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  NO_SHOW: 'danger',
  CANCELLED: 'muted',
};

const ICON: Record<SessionStatus, string> = {
  WAITING: '⏳',
  IN_PROGRESS: '▶',
  COMPLETED: '✓',
  NO_SHOW: '✕',
  CANCELLED: '—',
};

/** 세션 진행 상태 배지(색상+아이콘+한국어 라벨). 9-B: 공통 Badge 사용. */
export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  return (
    <Badge
      tone={STATUS_TONE[status]}
      icon={ICON[status]}
      className="min-w-[72px] justify-center"
    >
      {SESSION_STATUS_LABELS[status]}
    </Badge>
  );
}
