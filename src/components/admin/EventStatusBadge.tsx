import { Badge } from '@/components/common/Badge';
import { EVENT_STATUS_LABELS } from '@/lib/labels';
import type { Tone } from '@/lib/tone';
import type { EventStatus } from '@/types/event';

/**
 * 행사 상태 배지 (page_admin_event_list.md §1.2 / EventStatusBadge.jsx).
 * 9-A/9-B: 색은 의미 tone, 마크업은 공통 Badge 로 통일한다.
 */
const STATUS_TONE: Record<EventStatus, Tone> = {
  DRAFT: 'muted',
  BOOKING: 'info',
  ALLOCATION: 'ai',
  PROGRESS: 'success',
  FINISHED: 'neutral',
  CANCELLED: 'danger',
};

export function EventStatusBadge({ status }: { status: EventStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{EVENT_STATUS_LABELS[status]}</Badge>;
}
